using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Xml.Linq;
using Microsoft.Win32;

internal static class WordSetup
{
    internal const string Id = "6f1d7c52-3b0e-4b6a-9a52-0a1c4f6f7c13";
    private const string RegistryPath = @"Software\Microsoft\Office\16.0\WEF\Developer";
    internal static string DirectoryPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ObsidianInWord");
    internal static string ManifestPath => Path.Combine(DirectoryPath, "manifest.windows.xml");
    private static string ThumbprintPath => Path.Combine(DirectoryPath, "certificate-thumbprint");
    internal static X509Certificate2? FindCertificate()
    {
        if (!File.Exists(ThumbprintPath)) return null;var thumb = File.ReadAllText(ThumbprintPath).Trim();
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadOnly);
        var cert = store.Certificates.Find(X509FindType.FindByThumbprint, thumb, false).OfType<X509Certificate2>().FirstOrDefault();
        if (cert is null || !cert.HasPrivateKey || cert.NotAfter.ToUniversalTime() < DateTime.UtcNow.AddDays(1)) { cert?.Dispose();return null; }
        using var roots = new X509Store(StoreName.Root, StoreLocation.CurrentUser);roots.Open(OpenFlags.ReadOnly);
        if (roots.Certificates.Find(X509FindType.FindByThumbprint, thumb, false).Count == 0) { cert.Dispose();return null; }
        return cert;
    }
    internal static bool Registered()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath);return (key?.GetValue(Id) as string) == ManifestPath && File.Exists(ManifestPath);
    }
    internal static void Install()
    {
        Directory.CreateDirectory(DirectoryPath);
        using var registration = Registry.CurrentUser.CreateSubKey(RegistryPath);
        var previous = registration.GetValue(Id) as string;if (previous is not null && previous != ManifestPath) throw new InvalidOperationException("동일한 애드인 ID의 다른 등록이 있습니다. 덮어쓰지 않았습니다.");
        using var existing = FindCertificate();
        if (existing is null)
        {
            Remove();
            using var rsa = RSA.Create(2048);var request = new CertificateRequest("CN=localhost", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            var san = new SubjectAlternativeNameBuilder();san.AddDnsName("localhost");request.CertificateExtensions.Add(san.Build());
            request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
            request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
            request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, true));
            using var generated = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddYears(2));
            var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            using var cert = X509CertificateLoader.LoadPkcs12(generated.Export(X509ContentType.Pfx, password), password, X509KeyStorageFlags.UserKeySet | X509KeyStorageFlags.PersistKeySet);
            cert.FriendlyName = "Obsidian in Word localhost";
            using var mine = new X509Store(StoreName.My, StoreLocation.CurrentUser);mine.Open(OpenFlags.ReadWrite);mine.Add(cert);
            File.WriteAllText(ThumbprintPath, cert.Thumbprint);
            using var root = new X509Store(StoreName.Root, StoreLocation.CurrentUser);root.Open(OpenFlags.ReadWrite);
            using var publicCertificate = X509CertificateLoader.LoadCertificate(cert.Export(X509ContentType.Cert));root.Add(publicCertificate);
        }
        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("host-manifest.xml")!;var xml = XDocument.Load(source);XNamespace ns = "http://schemas.microsoft.com/office/appforoffice/1.1";
        xml.Root!.Element(ns + "Id")!.Value = Id;xml.Root.Element(ns + "DisplayName")!.SetAttributeValue("DefaultValue", "Obsidian in Word (Windows)");
        xml.Descendants(ns + "SourceLocation").Single().SetAttributeValue("DefaultValue", HostServer.Origin + "/index.html");xml.Save(ManifestPath);
        using var developer = Registry.CurrentUser.CreateSubKey(RegistryPath);
        developer.SetValue(Id, ManifestPath, RegistryValueKind.String);
    }
    internal static void Remove()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, true);if ((key?.GetValue(Id) as string) == ManifestPath) key.DeleteValue(Id);
        if (!File.Exists(ThumbprintPath)) return;var thumb = File.ReadAllText(ThumbprintPath).Trim();
        foreach (var name in new[] { StoreName.Root, StoreName.My })
        {
            using var store = new X509Store(name, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);
            foreach (var cert in store.Certificates.Find(X509FindType.FindByThumbprint, thumb, false)) { if (cert.Subject == "CN=localhost") store.Remove(cert);cert.Dispose(); }
        }
        File.Delete(ThumbprintPath);
    }
}
