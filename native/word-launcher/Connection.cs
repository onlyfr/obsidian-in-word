using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ObsidianInWord.Launcher
{
    // Office Extensibility IDTExtensibility2, kept local so installation needs no Office PIAs.
    [ComImport, Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IOfficeConnection
    {
        [DispId(1)] void OnConnection([MarshalAs(UnmanagedType.IDispatch)] object app, int mode, [MarshalAs(UnmanagedType.IDispatch)] object instance, [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(2)] void OnDisconnection(int mode, [In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(3)] void OnAddInsUpdate([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(4)] void OnStartupComplete([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_VARIANT)] ref Array custom);
        [DispId(5)] void OnBeginShutdown([In, MarshalAs(UnmanagedType.SafeArray, SafeArraySubType=VarEnum.VT_VARIANT)] ref Array custom);
    }

    [ComVisible(true), Guid("064076AA-D3F9-4FFE-8CA5-2EE3BC4DF1B8"), ClassInterface(ClassInterfaceType.None)]
    public sealed class Connection : IOfficeConnection
    {
        private CancellationTokenSource lifetime;
        private readonly object launchLock = new object();
        private DateTime lastLaunch;
        private const int Port = 49176;
        private static readonly string Settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ObsidianInWord");

        public void OnConnection(object app, int mode, object instance, ref Array custom)
        {
            if (lifetime != null) return;
            lifetime = new CancellationTokenSource();
            var token = lifetime.Token;
            Task.Run(() => Listen(token));
        }
        public void OnDisconnection(int mode, ref Array custom) { Stop(); }
        public void OnBeginShutdown(ref Array custom) { Stop(); }
        public void OnStartupComplete(ref Array custom) { }
        public void OnAddInsUpdate(ref Array custom) { }
        private void Stop() { var source = Interlocked.Exchange(ref lifetime, null); if (source != null) source.Cancel(); }

        private async Task Listen(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                var listener = new TcpListener(IPAddress.Loopback, Port);
                try
                {
                    listener.ExclusiveAddressUse = true;
                    listener.Start(8);
                    using (token.Register(listener.Stop))
                    {
                        // Bounded work stays off Word's UI thread, even during shutdown.
                        using (var slots = new SemaphoreSlim(4))
                        {
                            while (!token.IsCancellationRequested)
                            {
                                await slots.WaitAsync(token);
                                var client = await listener.AcceptTcpClientAsync();
                                _ = Task.Run(() => { try { Handle(client, token); } catch (Exception) { } finally { try { slots.Release(); } catch (ObjectDisposedException) { } } });
                            }
                        }
                    }
                }
                catch (Exception) when (!token.IsCancellationRequested) { await Task.Delay(1000, token); }
                catch (Exception) when (token.IsCancellationRequested) { return; }
                finally { listener.Stop(); }
            }
        }

        private void Handle(TcpClient client, CancellationToken token)
        {
            using (client)
            using (token.Register(client.Close))
            using (var deadline = new Timer(_ => client.Close(), null, 12000, Timeout.Infinite))
            using (var store = new X509Store(StoreName.My, StoreLocation.CurrentUser))
            {
                store.Open(OpenFlags.ReadOnly);
                var matches = store.Certificates.Find(X509FindType.FindByThumbprint, File.ReadAllText(Path.Combine(Settings, "certificate-thumbprint")).Trim(), false);
                if (matches.Count == 0) return;
                using (var cert = matches[0])
                using (var ssl = new SslStream(client.GetStream()))
                {
                    ssl.AuthenticateAsServer(cert, false, SslProtocols.Tls12, false);
                    var header = new StringBuilder();
                    while (header.Length < 8192)
                    {
                        int value = ssl.ReadByte();
                        if (value < 0 || value > 127) return;
                        header.Append((char)value);
                        int n = header.Length;
                        if (n >= 4 && header[n-4]=='\r' && header[n-3]=='\n' && header[n-2]=='\r' && header[n-1]=='\n') break;
                    }
                    var lines = header.ToString().Split(new[] {"\r\n"}, StringSplitOptions.None);
                    if (header.Length >= 8192 || !Array.Exists(lines, l => l.Equals("Host: localhost:49176", StringComparison.OrdinalIgnoreCase))) return;
                    var first = lines[0].Split(' ');
                    if (first.Length != 3 || first[0] != "GET") return;
                    var path = first[1].Split('?')[0];
                    if (path == "/icon16.png" || path == "/icon32.png" || path == "/icon80.png")
                    {
                        using (var icon = typeof(Connection).Assembly.GetManifestResourceStream(path.Substring(1)))
                        { Reply(ssl, "200 OK", "Content-Type: image/png\r\n", icon.Length); icon.CopyTo(ssl); }
                        return;
                    }
                    var key = File.ReadAllText(Path.Combine(Settings, "launch-key")).Trim();
                    if (key.Length != 32 || path != "/open/" + key) { Reply(ssl,"404 Not Found","",0); return; }
                    var ready = Ready(cert);
                    if (!ready)
                    {
                        lock (launchLock)
                        {
                            if ((DateTime.UtcNow-lastLaunch).TotalSeconds > 8 && !Ready(cert))
                            {
                                var exe = File.ReadAllText(Path.Combine(Settings,"launch-app")).Trim();
                                Process.Start(new ProcessStartInfo(exe, "--from-word") { UseShellExecute = false })?.Dispose();
                                lastLaunch = DateTime.UtcNow;
                            }
                        }
                        var watch = Stopwatch.StartNew();
                        while (watch.ElapsedMilliseconds < 8000 && !token.IsCancellationRequested)
                        {
                            ready = Ready(cert);
                            if (ready || token.WaitHandle.WaitOne(80)) break;
                        }
                    }
                    if (!ready || token.IsCancellationRequested) { Reply(ssl,"503 Service Unavailable","",0); return; }
                    var query = first[1].Substring(path.Length);
                    if (Array.Exists(query.ToCharArray(), c => c < 33 || c == 127)) return;
                    Reply(ssl, "307 Temporary Redirect", "Location: https://localhost:49175/index.html" + query + "\r\nReferrer-Policy: no-referrer\r\n", 0);
                }
            }
        }

        private static bool Ready(X509Certificate2 certificate)
        {
            using (var client = new TcpClient())
            {
                try
                {
                    client.SendTimeout = client.ReceiveTimeout = 700;
                    client.Connect(IPAddress.Loopback, 49175);
                    using (var ssl = new SslStream(client.GetStream(),false,
                        (_, peer, chain, errors) => errors == SslPolicyErrors.None && peer != null &&
                            string.Equals(peer.GetCertHashString(),certificate.Thumbprint,StringComparison.OrdinalIgnoreCase)))
                        ssl.AuthenticateAsClient("localhost");
                    return true;
                }
                catch (AuthenticationException) { return false; }
                catch (IOException) { return false; }
                catch (SocketException) { return false; }
            }
        }
        private static void Reply(Stream stream,string status,string extra,long length)
        {
            var bytes = Encoding.ASCII.GetBytes("HTTP/1.1 "+status+"\r\nConnection: close\r\nCache-Control: no-store\r\n"+extra+"Content-Length: "+length+"\r\n\r\n");
            stream.Write(bytes,0,bytes.Length);
        }
    }
}
