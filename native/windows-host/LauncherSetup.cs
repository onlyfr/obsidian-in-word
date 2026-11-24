using System.Reflection;
using System.Security.Cryptography;
using Microsoft.Win32;

internal static class LauncherSetup
{
    private const string ProgId = "ObsidianInWord.WordLauncher";
    private const string ClassId = "{064076AA-D3F9-4FFE-8CA5-2EE3BC4DF1B8}";
    private const string Classes = @"Software\Classes\";
    private const string Addin = @"Software\Microsoft\Office\Word\Addins\" + ProgId;
    private static readonly string[] Keys = [Classes + @"CLSID\" + ClassId, Classes + ProgId, Addin];
    private static string FilePath(string name) => Path.Combine(WordSetup.DirectoryPath, name);
    internal static string? Key() => File.Exists(FilePath("launch-key")) ? File.ReadAllText(FilePath("launch-key")).Trim() : null;

    private static RegistryKey User() => RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64);
    private static void CheckOwner(RegistryKey user)
    {
        foreach (var path in Keys)
        {
            using var key = user.OpenSubKey(path);
            if (key != null && !Equals(key.GetValue("OiwOwner"), WordSetup.ManifestPath))
                throw new InvalidOperationException("같은 이름의 다른 Word 시작 구성 요소가 등록되어 있습니다.");
        }
    }

    internal static void Install(Action connectWord)
    {
        using var user = User();
        Install(user, WordSetup.DirectoryPath, connectWord);
    }

    internal static void Install(RegistryKey user, string directory, Action connectWord)
    {
        string FilePath(string name) => Path.Combine(directory,name);
        CheckOwner(user);
        var undo = new Stack<Action>();
        void OwnedKey(string path)
        {
            using var existing = user.OpenSubKey(path);
            if (existing != null) return;
            using var created = user.CreateSubKey(path);
            undo.Push(() => user.DeleteSubKey(path,false));
        }
        void Value(string path,string name,object value,RegistryValueKind kind = RegistryValueKind.String)
        {
            OwnedKey(path);
            using var key = user.OpenSubKey(path,true)!;
            var previous = key.GetValue(name);
            var previousKind = previous == null ? kind : key.GetValueKind(name);
            key.SetValue(name,value,kind);
            undo.Push(() =>
            {
                using var changed = user.OpenSubKey(path,true);
                if (changed == null || !Equals(changed.GetValue(name),value)) return;
                if (previous == null) changed.DeleteValue(name,false);
                else changed.SetValue(name,previous,previousKind);
            });
        }
        void FileValue(string path,byte[] value)
        {
            var previous = File.Exists(path) ? File.ReadAllBytes(path) : null;
            if (previous != null && previous.SequenceEqual(value)) return;
            Write(path,value);
            undo.Push(() => { if (previous == null) File.Delete(path); else Write(path,previous); });
        }

        Directory.CreateDirectory(directory);
        using var resource = typeof(LauncherSetup).Assembly.GetManifestResourceStream("word-launcher.dll")!;
        using var bytes = new MemoryStream();
        resource.CopyTo(bytes);
        var dll = bytes.ToArray();
        var path = FilePath("launcher-" + Convert.ToHexString(SHA256.HashData(dll)) + ".dll");
        try
        {
            FileValue(path,dll);
            if (!File.Exists(FilePath("launch-key")) || !Guid.TryParseExact(File.ReadAllText(FilePath("launch-key")).Trim(),"N",out _))
                FileValue(FilePath("launch-key"),System.Text.Encoding.ASCII.GetBytes(Guid.NewGuid().ToString("N")));
            var exe = Environment.ProcessPath ?? throw new IOException("앱 경로를 확인할 수 없습니다.");
            FileValue(FilePath("launch-app"),System.Text.Encoding.UTF8.GetBytes(exe));
            foreach (var root in Keys) Value(root,"OiwOwner",WordSetup.ManifestPath);
            var server = Keys[0] + @"\InprocServer32";
            Value(server,"", "mscoree.dll");
            Value(server,"ThreadingModel","Both");
            Value(server,"RuntimeVersion","v4.0.30319");
            Value(server,"Class","ObsidianInWord.Launcher.Connection");
            Value(server,"Assembly",AssemblyName.GetAssemblyName(path).FullName!);
            Value(server,"CodeBase",new Uri(path).AbsoluteUri);
            Value(Keys[1]+@"\CLSID","",ClassId);
            Value(Addin,"FriendlyName","Obsidian in Word — 작업창 시작");
            Value(Addin,"Description","Word에서 Markdown 작업창을 열 때 Windows 앱을 시작합니다.");
            Value(Addin,"LoadBehavior",3,RegistryValueKind.DWord);
            connectWord();
        }
        catch (Exception failure)
        {
            var errors = new List<Exception> {failure};
            while (undo.TryPop(out var restore))
                try { restore(); } catch (Exception error) { errors.Add(error); }
            if (errors.Count > 1) throw new AggregateException("Word 시작 설정을 복원하지 못했습니다.",errors);
            throw;
        }
    }
    private static void Write(string path, byte[] bytes)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N");
        try { File.WriteAllBytes(temporary,bytes); File.Move(temporary,path,true); }
        finally { File.Delete(temporary); }
    }
    internal static void Remove()
    {
        using var user = User();
        Remove(user,WordSetup.DirectoryPath);
    }

    internal static void Remove(RegistryKey user,string directory)
    {
        CheckOwner(user);
        foreach (var path in Keys.Reverse()) user.DeleteSubKeyTree(path,false);
        File.Delete(Path.Combine(directory,"launch-app")); File.Delete(Path.Combine(directory,"launch-key"));
        if (!Directory.Exists(directory)) return;
        foreach (var file in Directory.EnumerateFiles(directory,"launcher-*.dll"))
        {
            var expected = "launcher-" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))) + ".dll";
            if (!string.Equals(Path.GetFileName(file), expected, StringComparison.OrdinalIgnoreCase)) continue;
            try { File.Delete(file); } catch (IOException) { /* Word may still have the assembly mapped. */ }
        }
    }
}
