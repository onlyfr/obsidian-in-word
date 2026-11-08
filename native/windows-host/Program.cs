using System.Diagnostics;
using System.Security.Cryptography.X509Certificates;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var singleton = new Mutex(true, @"Local\ObsidianInWord.WindowsHost", out var first);
        if (!first) { MessageBox.Show("Obsidian in Word가 이미 실행 중입니다.");return; }
        System.Windows.Forms.Application.SetHighDpiMode(HighDpiMode.SystemAware);System.Windows.Forms.Application.EnableVisualStyles();
        using var form = new Form { Text = "Obsidian in Word", Width = 640, Height = 350, StartPosition = FormStartPosition.CenterScreen };
        using var tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Obsidian in Word", Visible = false };
        WebApplication? host = null;X509Certificate2? certificate = null;var quitting = false;
        var status = new Label { Dock = DockStyle.Top, Height = 80, Padding = new Padding(12), Text = "Word 연결 상태를 확인하는 중…" };
        var help = new Label { Dock = DockStyle.Top, Height = 85, Padding = new Padding(12), Text = "처음 한 번 ‘Word 연결 설정’을 누르세요. 현재 사용자에게 localhost 인증서와 이 앱의 Word 애드인을 등록합니다.\nWord에서 홈/삽입 → 추가 기능 → 내 추가 기능의 Obsidian in Word (Windows)를 여세요.\n창을 닫아도 앱은 알림 영역에서 실행됩니다. 종료하면 작업창 연결이 끊깁니다." };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 50, Padding = new Padding(8) };
        var setup = new Button { Text = "Word 연결 설정", AutoSize = true };var word = new Button { Text = "Word 열기", AutoSize = true };var remove = new Button { Text = "Word 연결 해제", AutoSize = true };var exit = new Button { Text = "앱 종료", AutoSize = true };
        buttons.Controls.AddRange([setup, word, remove, exit]);form.Controls.Add(buttons);form.Controls.Add(help);form.Controls.Add(status);
        async Task Stop(){if (host is not null) { await host.StopAsync();await host.DisposeAsync();host = null; }certificate?.Dispose();certificate = null;}
        async Task Start()
        {
            try { certificate = WordSetup.FindCertificate();if (certificate is null || !WordSetup.Registered()) { certificate?.Dispose();certificate = null;status.Text = "처음 사용: Word 연결 설정이 필요합니다.";return; }
                host = HostServer.Build(certificate);await host.StartAsync();status.Text = "연결 준비됨 · 편집기와 플러그인 다운로드를 이 앱에서 제공합니다.\nWord가 이미 열려 있었다면 앱 등록을 표시하기 위해 Word를 다시 열어야 할 수 있습니다."; }
            catch (Exception error){await Stop();status.Text = "시작 실패: " + error.Message;}
        }
        setup.Click += async (_, _) => { setup.Enabled = remove.Enabled = false;try { await Stop();WordSetup.Install();await Start(); }catch (Exception error){status.Text = "연결 설정 실패: " + error.Message;}finally{setup.Enabled = remove.Enabled = true;} };
        remove.Click += async (_, _) => { if (MessageBox.Show("이 앱의 Word 등록과 localhost 인증서를 해제합니다. 문서와 플러그인 데이터는 유지합니다.", "Word 연결 해제", MessageBoxButtons.OKCancel) != DialogResult.OK)return;try {await Stop();WordSetup.Remove();status.Text = "Word 연결을 해제했습니다.";}catch (Exception error){status.Text = error.Message;} };
        word.Click += (_, _) => { try {Process.Start(new ProcessStartInfo("winword.exe") { UseShellExecute = true });}catch (Exception error){status.Text = "Word를 열 수 없습니다: " + error.Message;} };
        void Show(){form.Show();form.WindowState = FormWindowState.Normal;form.Activate();tray.Visible = false;}
        var menu = new ContextMenuStrip();menu.Items.Add("앱 열기", null, (_, _) => Show());menu.Items.Add("종료", null, (_, _) => {quitting = true;form.Close();});tray.ContextMenuStrip = menu;tray.DoubleClick += (_, _) => Show();
        exit.Click += (_, _) => {quitting = true;form.Close();};
        form.FormClosing += (_, e) => { if (!quitting){e.Cancel = true;form.Hide();tray.Visible = true;} };
        form.Shown += async (_, _) => await Start();System.Windows.Forms.Application.Run(form);SynchronizationContext.SetSynchronizationContext(null);Stop().GetAwaiter().GetResult();tray.Visible = false;
    }
}
