using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

var checks = new List<string>();
void Must(bool value, string message) { if (!value) throw new Exception(message); }
void Throws(Action action) { try { action(); } catch { return; }throw new Exception("Expected refusal"); }
void Test(string name, Action action) { action();checks.Add(name); }
const string path = "owned-manifest";
SetupManager Manager(FakeStore store) => new(store, path, () => WordSetup.CreateCertificate(false));

Test("new install, repeat and owned removal", () => {
    using var store = new FakeStore();var manager = Manager(store);manager.Install();var thumb = store.Thumbprint;
    Must(manager.Registered() && manager.FindCertificate() is not null && store.Pending is null, "new install");
    manager.Install();Must(store.Thumbprint == thumb && store.Personal.Count == 1 && store.Roots.Count == 1, "idempotent repeat");
    manager.Remove();Must(store.Registration is null && store.Thumbprint is null && store.Pending is null && store.Personal.Count == 0 && store.Roots.Count == 0, "owned cleanup");
});
foreach (var stage in new[] { "pending:before", "pending:after", "personal:before", "personal:after", "trust:before", "trust:after", "manifest:before", "manifest:after", "thumb:before", "thumb:after", "registration:before", "registration:after" })
    Test("failed initial install: " + stage, () => {
        using var store = new FakeStore { Fail = stage };var manager = Manager(store);Throws(manager.Install);
        Must(store.Registration is null && store.Manifest is null && store.Thumbprint is null && store.Pending is null && store.Personal.Count == 0 && store.Roots.Count == 0, stage + " leaked installation");
    });
Test("trust refusal without exception is not accepted", () => {
    using var store = new FakeStore { IgnoreTrust = true };Throws(Manager(store).Install);
    Must(store.Registration is null && store.Personal.Count == 0 && store.Roots.Count == 0, "untrusted install");
});
foreach (var stage in new[] { "trust:after", "manifest:after", "thumb:after", "registration:after" })
    Test("failed renewal preserves old connection: " + stage, () => {
        using var store = new FakeStore();using var old = FakeStore.Expired();store.Seed(old);store.Fail = stage;
        var manager = Manager(store);Throws(manager.Install);
        Must(store.Registration == path && store.Thumbprint == old.Thumbprint && store.Manifest == SetupManager.BuildManifest() && store.Roots.ContainsKey(old.Thumbprint) && store.Personal.Count == 1, "old connection lost");
    });
Test("renewal retires old certificate only after commit", () => {
    using var store = new FakeStore();using var old = FakeStore.Expired();store.Seed(old);Manager(store).Install();
    Must(store.Thumbprint != old.Thumbprint && !store.Roots.ContainsKey(old.Thumbprint) && store.Personal.Count == 1, "old certificate retained");
});
Test("conflicting registration stays untouched", () => {
    using var store = new FakeStore { RegistrationValue = "foreign" };Throws(Manager(store).Install);
    Must(store.Registration == "foreign" && store.Personal.Count == 0, "foreign registration changed");
});
Test("removal preserves another registration", () => {
    using var store = new FakeStore { RegistrationValue = "foreign" };Manager(store).Remove();Must(store.Registration == "foreign", "foreign registration removed");
});
Test("PR44 localhost certificate remains reusable", () => {
    using var store = new FakeStore();using var old = FakeStore.Legacy();store.Seed(old);var manager = Manager(store);manager.Install();
    Must(store.Thumbprint == old.Thumbprint && store.Personal.Count == 1, "legacy certificate replaced unnecessarily");
});
Test("pending cleanup survives failure and is retryable", () => {
    using var store = new FakeStore();var manager = Manager(store);manager.Install();store.Fail = "remove-trust:before";Throws(manager.Remove);
    Must(store.Pending is not null && store.Roots.Count == 1, "lost cleanup ownership record");manager.Remove();Must(store.Pending is null && store.Roots.Count == 0 && store.Personal.Count == 0, "retry failed");
});
Test("crash after commit does not remove active certificate", () => {
    using var store = new FakeStore();var manager = Manager(store);manager.Install();store.Pending = store.Thumbprint;var thumb = store.Thumbprint;
    manager.Install();Must(store.Thumbprint == thumb && store.Roots.Count == 1 && store.Pending is null, "active pending certificate removed");
});
Test("unrelated certificate is never deleted", () => {
    using var store = new FakeStore();using var foreign = FakeStore.Expired("CN=unrelated");store.Seed(foreign);Throws(Manager(store).Remove);
    Must(store.Roots.ContainsKey(foreign.Thumbprint) && store.Personal.ContainsKey(foreign.Thumbprint), "foreign cert removed");
});
Test("production certificate profile is localhost-only and non-CA", () => {
    using var cert = WordSetup.CreateCertificate(false);
    Must(cert.Subject == SetupManager.Subject && cert.HasPrivateKey, "identity/key");
    Must(cert.Extensions.OfType<X509BasicConstraintsExtension>().Single().CertificateAuthority == false, "CA privilege");
    var san = cert.Extensions.OfType<X509SubjectAlternativeNameExtension>().Single();Must(san.EnumerateDnsNames().SequenceEqual(new[] { "localhost" }), "SAN");
    Must(cert.Extensions.OfType<X509EnhancedKeyUsageExtension>().Single().EnhancedKeyUsages.Cast<Oid>().Single().Value == "1.3.6.1.5.5.7.3.1", "EKU");
});
Test("legacy manifest declaration and whitespace stay registered; malformed XML refuses", () => {
    using var store = new FakeStore();var manager = Manager(store);manager.Install();
    store.Manifest = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" + store.Manifest;
    Must(manager.Registered(), "format-only difference invalidated registration");store.Manifest = "<invalid";Must(!manager.Registered(), "malformed manifest accepted");
});

var entered = new TaskCompletionSource();var finish = new TaskCompletionSource();var stops = 0;
var operations = new HostOperations(() => { stops++;return Task.CompletedTask; });
var running = operations.TryRun(async () => { entered.SetResult();await finish.Task; });await entered.Task;
Must(!await operations.TryRun(() => throw new Exception("overlap")), "overlapping operation accepted");
var closing = operations.Close();Must(!closing.IsCompleted && stops == 0, "shutdown did not wait");
Must(ReferenceEquals(closing, operations.Close()), "duplicate shutdown");finish.SetResult();await running;await closing;
Must(stops == 1 && !await operations.TryRun(() => throw new Exception("after close")), "work after shutdown");checks.Add("serialized work, exit waits and stops once");
var failedOperations = new HostOperations(() => Task.CompletedTask);
try { await failedOperations.TryRun(() => throw new Exception("injected")); } catch { }
Must(await failedOperations.TryRun(() => Task.CompletedTask), "failed action wedged operation gate");checks.Add("failed action releases operation gate");
Console.WriteLine(JsonSerializer.Serialize(new { passed = checks.Count, checks, realTrustStoreModified = false }, new JsonSerializerOptions { WriteIndented = true }));

sealed class FakeStore : ISetupStore, IDisposable
{
    internal string? Fail;internal bool IgnoreTrust;internal string? RegistrationValue;
    internal readonly Dictionary<string, X509Certificate2> Personal = new(), Roots = new();
    private string? manifest, thumb, pending;
    public string? Registration => RegistrationValue;
    private void Write(string stage, Action change) { if (Fail == stage + ":before") { Fail = null;throw new IOException(stage); }change();if (Fail == stage + ":after") { Fail = null;throw new IOException(stage); } }
    public void ChangeRegistration(string? expected, string? value) { if (RegistrationValue != expected) throw new Exception("changed registration");Write("registration", () => RegistrationValue = value); }
    public string? Manifest { get => manifest;set => Write("manifest", () => manifest = value); }
    public string? Thumbprint { get => thumb;set => Write("thumb", () => thumb = value); }
    public string? Pending { get => pending;set => Write("pending", () => pending = value); }
    public X509Certificate2? Certificate(string value) => Personal.TryGetValue(value, out var cert) || Roots.TryGetValue(value, out cert) ? new X509Certificate2(cert) : null;
    public bool Trusted(string value) => Roots.ContainsKey(value);
    public void AddPersonal(X509Certificate2 cert) => Write("personal", () => Personal.Add(cert.Thumbprint, new X509Certificate2(cert)));
    public void AddTrust(X509Certificate2 cert) => Write("trust", () => { if (!IgnoreTrust) Roots.Add(cert.Thumbprint, X509CertificateLoader.LoadCertificate(cert.Export(X509ContentType.Cert))); });
    public void RemoveTrust(string value) => Write("remove-trust", () => { if (Roots.Remove(value, out var cert)) cert.Dispose(); });
    public void RemovePersonal(string value) { if (Personal.Remove(value, out var cert)) cert.Dispose(); }
    internal void Seed(X509Certificate2 cert) { RegistrationValue = "owned-manifest";manifest = SetupManager.BuildManifest();thumb = cert.Thumbprint;AddPersonal(cert);AddTrust(cert); }
    internal static X509Certificate2 Expired(string subject = SetupManager.Subject)
    { using var rsa = RSA.Create(2048);var req = new CertificateRequest(subject, rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddYears(-2), DateTimeOffset.UtcNow.AddDays(-1));return X509CertificateLoader.LoadPkcs12(cert.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.EphemeralKeySet); }
    internal static X509Certificate2 Legacy()
    { using var rsa = RSA.Create(2048);var req = new CertificateRequest("CN=localhost", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));var value = X509CertificateLoader.LoadPkcs12(cert.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.EphemeralKeySet);value.FriendlyName = SetupManager.CertificateName;return value; }
    public void Dispose() { foreach (var cert in Personal.Values.Concat(Roots.Values)) cert.Dispose(); }
}
