using System.Text.Json;

namespace Feelgood.Atelier.Sidecar.Api;

/// <summary>
/// One build job: an append-only list of pre-serialized SSE payloads plus a
/// pulse that wakes waiting SSE readers. Multiple subscribers may replay the
/// stream concurrently; events are retained until the store evicts the job
/// (~10 min after completion).
/// </summary>
public sealed class BuildJob
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly object _gate = new();
    private readonly List<string> _events = new();
    private TaskCompletionSource _pulse = NewPulse();

    public string JobId { get; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; private set; }
    public bool IsDone => FinishedAt != null;

    private static TaskCompletionSource NewPulse() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Report(string phase, int current, int total, string message) =>
        Append(JsonSerializer.Serialize(new { phase, current, total, message }, JsonOptions), terminal: false);

    public void Complete(string outDir, object report) =>
        Append(JsonSerializer.Serialize(new { done = true, outDir, report }, JsonOptions), terminal: true);

    public void Fail(string error) =>
        Append(JsonSerializer.Serialize(new { done = true, error }, JsonOptions), terminal: true);

    private void Append(string payload, bool terminal)
    {
        lock (_gate)
        {
            if (IsDone) return; // never append past the terminal event
            _events.Add(payload);
            if (terminal) FinishedAt = DateTimeOffset.UtcNow;
            _pulse.TrySetResult();
            _pulse = NewPulse();
        }
    }

    /// <summary>Events from <paramref name="fromIndex"/>; also returns whether the stream is finished.</summary>
    public (IReadOnlyList<string> Events, bool Done) Read(int fromIndex)
    {
        lock (_gate)
        {
            var slice = fromIndex >= _events.Count
                ? Array.Empty<string>()
                : (IReadOnlyList<string>)_events.GetRange(fromIndex, _events.Count - fromIndex);
            return (slice, IsDone);
        }
    }

    /// <summary>Waits until new events arrive (or timeout); returns immediately when done.</summary>
    public async Task<bool> WaitForChangeAsync(int knownCount, TimeSpan timeout, CancellationToken ct)
    {
        Task pulse;
        lock (_gate)
        {
            if (IsDone || _events.Count > knownCount) return true;
            pulse = _pulse.Task;
        }
        var completed = await Task.WhenAny(pulse, Task.Delay(timeout, ct));
        return completed == pulse;
    }
}

/// <summary>
/// In-memory job registry. One running build per process (409 busy);
/// finished jobs stay queryable for ~10 minutes.
/// </summary>
public sealed class BuildJobStore
{
    private static readonly TimeSpan Retention = TimeSpan.FromMinutes(10);

    private readonly object _gate = new();
    private readonly Dictionary<string, BuildJob> _jobs = new();
    private BuildJob? _active;

    /// <summary>Registers a new job; returns null when another build is still running.</summary>
    public BuildJob? TryStart()
    {
        lock (_gate)
        {
            Evict();
            if (_active is { IsDone: false }) return null;
            var job = new BuildJob();
            _jobs[job.JobId] = job;
            _active = job;
            return job;
        }
    }

    public BuildJob? Get(string jobId)
    {
        lock (_gate)
        {
            Evict();
            return _jobs.GetValueOrDefault(jobId);
        }
    }

    private void Evict()
    {
        var cutoff = DateTimeOffset.UtcNow - Retention;
        foreach (var (jobId, job) in _jobs.Where(p => p.Value.FinishedAt is { } f && f < cutoff).ToList())
        {
            _jobs.Remove(jobId);
            if (ReferenceEquals(_active, job)) _active = null;
        }
    }
}
