using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class PortableLauncher
{
    const string ApplicationName = "豌豆AI工具.exe";
    const string RuntimeDirectoryName = "程序文件";

    static string Quote(string value)
    {
        if (String.IsNullOrEmpty(value)) return "\"\"";
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void HideEntry(string path)
    {
        try
        {
            if (File.Exists(path) || Directory.Exists(path))
                File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.Hidden);
        }
        catch { }
    }

    [STAThread]
    public static int Main(string[] args)
    {
        var root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var runtime = Path.Combine(root, RuntimeDirectoryName);
        var executable = Path.Combine(runtime, ApplicationName);
        HideEntry(runtime);
        HideEntry(Path.Combine(root, "resources"));
        HideEntry(Path.Combine(root, "wandou-ai-update.log"));

        if (!File.Exists(executable)) return 2;
        try
        {
            var process = Process.Start(new ProcessStartInfo(executable)
            {
                Arguments = String.Join(" ", Array.ConvertAll(args, Quote)),
                WorkingDirectory = runtime,
                UseShellExecute = false
            });
            if (process == null) return 3;
            // 旧版更新器会在 1.5 秒后确认外层 EXE 仍然存活。保留一个短暂、
            // 无窗口的代理进程，确保 v1.0.68 等旧版能够可靠完成首次迁移。
            Thread.Sleep(3000);
            return process.HasExited ? process.ExitCode : 0;
        }
        catch
        {
            return 4;
        }
    }
}
