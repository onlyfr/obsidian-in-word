using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Xml.Linq;
using Microsoft.Win32;

internal interface ISetupStore
{
    string? Registration { get; }
    void ChangeRegistration(string? expected, string? value);
    string? Manifest { get; set; }
    string? Thumbprint { get; set; }
    string? Pending { get; set; }
    X509Certificate2? Certificate(string thumbprint);
    bool Trusted(string thumbprint);
    void AddPersonal(X509Certificate2 certificate);
    void AddTrust(X509Certificate2 certificate);
    void RemoveTrust(string thumbprint);
    void RemovePersonal(string thumbprint);
}

internal sealed class SetupManager(ISetupStore store, string manifestPath, Func<X509Certificate2> createCertificate)
{
    internal const string CertificateName = "Obsidian in Word localhost";
    internal const string Subject = "CN=localhost, O=Obsidian in Word";
    internal static bool Owned(X509Certificate2 cert) => cert.Subject == Subject ||
        (cert.Subject == "CN=localhost" && cert.FriendlyName == CertificateName);

    internal X509Certificate2? FindCertificate()
    {
        var thumb = store.Thumbprint;if (thumb is null) return null;
        var cert = store.Certificate(thumb);if (cert is null) return null;
        if (Owned(cert) && cert.HasPrivateKey && cert.NotBefore.ToUniversalTime() <= DateTime.UtcNow &&
            cert.NotAfter.ToUniversalTime() > DateTime.UtcNow.AddDays(1) && store.Trusted(thumb)) return cert;
        cert.Dispose();return null;
    }
    internal bool Registered()
    {
        if (store.Registration != manifestPath || store.Manifest is not string manifest) return false;
        try { return XNode.DeepEquals(XDocument.Parse(manifest).Root, XDocument.Parse(BuildManifest()).Root); }
        catch (System.Xml.XmlException) { return false; }
    }
    internal void Install()
    {
        var previousRegistration = store.Registration;
        if (previousRegistration is not null && previousRegistration != manifestPath)
            throw new InvalidOperationException("동일한 애드인 ID의 다른 등록이 있습니다. 덮어쓰지 않았습니다.");
        CleanupPending();
        var previousManifest = store.Manifest;var previousThumb = store.Thumbprint;
        using var existing = FindCertificate();using var created = existing is null ? createCertificate() : null;
        var nextThumb = (created ?? existing!).Thumbprint;var nextManifest = BuildManifest();
        try
        {
            if (created is not null)
            {
                store.Pending = nextThumb; // Durable ownership record before certificate-store mutation.
                store.AddPersonal(created);store.AddTrust(created);
                if (!store.Trusted(nextThumb)) throw new InvalidOperationException("localhost 인증서 신뢰가 완료되지 않았습니다.");
            }
            store.Manifest = nextManifest;store.Thumbprint = nextThumb;
            store.ChangeRegistration(previousRegistration, manifestPath);
        }
        catch (Exception failure)
        {
            var errors = new List<Exception> { failure };
            void Attempt(Action action) { try { action(); } catch (Exception error) { errors.Add(error); } }
            Attempt(() => { if (store.Registration == manifestPath) store.ChangeRegistration(manifestPath, previousRegistration); });
            Attempt(() => { if (store.Manifest == nextManifest) store.Manifest = previousManifest; });
            Attempt(() => { if (store.Thumbprint == nextThumb) store.Thumbprint = previousThumb; });
            Attempt(CleanupPending);
            if (errors.Count > 1) throw new AggregateException("연결 설정 실패. 일부 정리가 남았습니다. 앱에서 다시 설정하거나 연결 해제하세요.", errors);
            throw;
        }
        store.Pending = null;
        if (created is not null && previousThumb is not null && previousThumb != nextThumb)
        { store.Pending = previousThumb;CleanupPending(); }
    }
    internal void Remove()
    {
        if (store.Registration == manifestPath) store.ChangeRegistration(manifestPath, null);
        CleanupPending();
        if (store.Thumbprint is not null)
        { store.Pending = store.Thumbprint;store.Thumbprint = null;CleanupPending(); }
    }
    private void CleanupPending()
    {
        var pending = store.Pending;if (pending is null) return;
        if (pending == store.Thumbprint && Registered())
        { using var active = FindCertificate();if (active is not null) { store.Pending = null;return; } }
        using var cert = store.Certificate(pending);
        if (cert is not null && !Owned(cert)) throw new InvalidOperationException("이 앱의 인증서로 확인되지 않아 삭제하지 않았습니다.");
        store.RemoveTrust(pending);store.RemovePersonal(pending);store.Pending = null;
    }
    internal static string BuildManifest()
    {
        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("host-manifest.xml")!;
        var xml = XDocument.Load(source);XNamespace ns = "http://schemas.microsoft.com/office/appforoffice/1.1";
        xml.Root!.Element(ns + "Id")!.Value = WordSetup.Id;
        xml.Root.Element(ns + "DisplayName")!.SetAttributeValue("DefaultValue", "Obsidian in Word (Windows)");
        xml.Descendants(ns + "SourceLocation").Single().SetAttributeValue("DefaultValue", HostServer.Origin + "/index.html");return xml.ToString();
    }
}

internal static class WordSetup
{
    internal const string Id = "6f1d7c52-3b0e-4b6a-9a52-0a1c4f6f7c13";
    internal static string DirectoryPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ObsidianInWord");
    internal static string ManifestPath => Path.Combine(DirectoryPath, "manifest.windows.xml");
    private static readonly SetupManager Manager = new(new WindowsSetupStore(), ManifestPath, () => CreateCertificate());
    internal static X509Certificate2? FindCertificate() => Manager.FindCertificate();
    internal static bool Registered() => Manager.Registered();
    internal static void Install() => Manager.Install();
    internal static void Remove() => Manager.Remove();
    internal static X509Certificate2 CreateCertificate(bool persistKey = true)
    {
        using var rsa = RSA.Create(2048);var request = new CertificateRequest(SetupManager.Subject, rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();san.AddDnsName("localhost");request.CertificateExtensions.Add(san.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, true));
        using var generated = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddYears(2));
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var cert = X509CertificateLoader.LoadPkcs12(generated.Export(X509ContentType.Pfx, password), password, persistKey
            ? X509KeyStorageFlags.UserKeySet | X509KeyStorageFlags.PersistKeySet : X509KeyStorageFlags.EphemeralKeySet);
        cert.FriendlyName = SetupManager.CertificateName;return cert;
    }
}

internal sealed class WindowsSetupStore : ISetupStore
{
    private const string RegistryPath = @"Software\Microsoft\Office\16.0\WEF\Developer";
    public string? Registration { get { using var key = Registry.CurrentUser.OpenSubKey(RegistryPath);return key?.GetValue(WordSetup.Id) switch { null => null, string value => value, _ => throw new InvalidOperationException("Word 등록 값 형식이 올바르지 않아 변경하지 않았습니다.") }; } }
    public void ChangeRegistration(string? expected, string? value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath);
        if (!Equals(key.GetValue(WordSetup.Id), expected)) throw new InvalidOperationException("Word 등록이 다른 작업에서 변경됐습니다. 다시 확인하세요.");
        if (value is null) key.DeleteValue(WordSetup.Id, false);else key.SetValue(WordSetup.Id, value, RegistryValueKind.String);
    }
    public string? Manifest { get => Read(WordSetup.ManifestPath);set => Write(WordSetup.ManifestPath, value); }
    public string? Thumbprint { get => Read(PathOf("certificate-thumbprint"))?.Trim();set => Write(PathOf("certificate-thumbprint"), value); }
    public string? Pending { get => Read(PathOf("certificate-pending"))?.Trim();set => Write(PathOf("certificate-pending"), value); }
    private static string PathOf(string name) => Path.Combine(WordSetup.DirectoryPath, name);
    private static string? Read(string path) => File.Exists(path) ? File.ReadAllText(path) : null;
    private static void Write(string path, string? text)
    {
        if (text is null) { File.Delete(path);return; }
        Directory.CreateDirectory(WordSetup.DirectoryPath);var temporary = path + "." + Guid.NewGuid().ToString("N");
        try { File.WriteAllText(temporary, text);File.Move(temporary, path, true); }finally { File.Delete(temporary); }
    }
    public X509Certificate2? Certificate(string thumbprint)
    {
        foreach (var name in new[] { StoreName.My, StoreName.Root })
        { using var store = new X509Store(name, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadOnly);var cert = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false).FirstOrDefault();if (cert is not null) return cert; }
        return null;
    }
    public bool Trusted(string thumbprint) { using var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadOnly);return store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false).Count > 0; }
    public void AddPersonal(X509Certificate2 cert) { using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);store.Add(cert); }
    public void AddTrust(X509Certificate2 cert) { using var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);using var publicCert = X509CertificateLoader.LoadCertificate(cert.Export(X509ContentType.Cert));store.Add(publicCert); }
    public void RemoveTrust(string thumbprint) => Remove(StoreName.Root, thumbprint);
    public void RemovePersonal(string thumbprint) => Remove(StoreName.My, thumbprint);
    private static void Remove(StoreName name, string thumbprint)
    { using var store = new X509Store(name, StoreLocation.CurrentUser);store.Open(OpenFlags.ReadWrite);foreach (var cert in store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false)) { store.Remove(cert);cert.Dispose(); } }
}
