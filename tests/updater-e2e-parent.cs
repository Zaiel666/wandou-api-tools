using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class UpdaterE2EParent
{
    static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    public static int Main(string[] args)
    {
        if (args.Length < 6 || args.Length > 7)
        {
            Console.Error.WriteLine("Expected: updater install package executable ready target [helper]");
            return 2;
        }

        var updaterArgs = "--install " + Quote(args[1])
            + " --package " + Quote(args[2])
            + " --exe " + Quote(args[3])
            + " --ready " + Quote(args[4])
            + " --target " + Quote(args[5])
            + " --parent " + Process.GetCurrentProcess().Id;

        // Reproduce the portable-app launch condition: the requesting app commonly
        // has the installation folder as its working directory. The updater must
        // detach from it before attempting a directory swap.
        Environment.CurrentDirectory = Path.GetFullPath(args[1]);
        if (args.Length == 7)
        {
            Process.Start(new ProcessStartInfo(Path.Combine(args[1], args[6]))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Environment.CurrentDirectory
            });
        }
        Process.Start(new ProcessStartInfo(args[0], updaterArgs)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Environment.CurrentDirectory
        });

        // A correct updater terminates this requesting parent while remaining alive itself.
        while (true) Thread.Sleep(1000);
    }
}
