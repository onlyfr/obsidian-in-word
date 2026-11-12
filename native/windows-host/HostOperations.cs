internal sealed class HostOperations(Func<Task> stop)
{
    private readonly SemaphoreSlim gate = new(1);
    private readonly object sync = new();
    private Task? closing;
    private int closingRequested;
    internal bool Busy => gate.CurrentCount == 0;
    internal bool Closing => Volatile.Read(ref closingRequested) != 0;
    internal event Action? Changed;
    internal async Task<bool> TryRun(Func<Task> action)
    {
        if (Closing || !await gate.WaitAsync(0)) return false;
        try
        {
            if (Closing) return false;
            Changed?.Invoke();await action();return true;
        }
        finally { gate.Release();Changed?.Invoke(); }
    }
    internal Task Close()
    {
        lock (sync)
        {
            if (closing is not null) return closing;
            Interlocked.Exchange(ref closingRequested, 1);
            closing = CloseCore();return closing;
        }
    }
    private async Task CloseCore()
    {
        Changed?.Invoke();await gate.WaitAsync();
        try { await stop(); }
        finally { gate.Release();Changed?.Invoke(); }
    }
}
