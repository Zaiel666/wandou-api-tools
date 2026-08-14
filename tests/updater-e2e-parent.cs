using System;
using System.Diagnostics;
using System.Threading;

internal static class UpdaterE2EParent
{
    static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    public static int Main(string[] args)
    {
        if (args.Length != 6)
        {
            Console.Error.WriteLine("Expected: updater install package executable ready target");
            return 2;
        }

        var updaterArgs = "--install " + Quote(args[1])
            + " --package " + Quote(args[2])
            + " --exe " + Quote(args[3])
            + " --ready " + Quote(args[4])
            + " --target " + Quote(args[5])
            + " --parent " + Process.GetCurrentProcess().Id;

        Process.Start(new ProcessStartInfo(args[0], updaterArgs)
        {
            UseShellExecute = false,
            CreateNoWindow = true
        });

        // A correct updater terminates this requesting parent while remaining alive itself.
        while (true) Thread.Sleep(1000);
    }
}
