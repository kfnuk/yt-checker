// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .catch(err => console.warn('Service worker registration failed:', err));
}

// ─── DOM References ───────────────────────────────────────────────────────────
const extractBtn   = document.getElementById('extractBtn');
const copyBtn      = document.getElementById('copyBtn');
const urlInput     = document.getElementById('urlInput');
const resultsTable = document.getElementById('resultsTable');
const resultsBody  = document.getElementById('resultsBody');
const statusDiv    = document.getElementById('status');

// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_PREFIX    = 'yt_oembed_';
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE      = 5;                   // concurrent requests per batch
const BATCH_DELAY_MS  = 300;                 // pause between batches (ms)

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Prune expired (or corrupt) cache entries on page load
 * to prevent localStorage from filling up over time.
 */
function pruneCacheEntries() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(CACHE_PREFIX)) continue;
        try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (!parsed || Date.now() >= parsed.expiry) {
                localStorage.removeItem(key);
            }
        } catch {
            localStorage.removeItem(key); // remove corrupt entries
        }
    }
}

pruneCacheEntries();

// ─── Video ID Extraction ──────────────────────────────────────────────────────
/**
 * Extract an 11-character YouTube video ID from a URL string.
 * The fallback regex is restricted to known YouTube domains
 * to avoid false positives on arbitrary path segments.
 */
function extractVideoId(url) {
    if (!url) return null;
    const s = String(url).trim();

    const match =
        s.match(/[?&]v=([A-Za-z0-9_-]{11})/)       ||
        s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)  ||
        s.match(/\/shorts\/([A-Za-z0-9_-]{11})/)   ||
        s.match(/\/embed\/([A-Za-z0-9_-]{11})/)    ||
        s.match(/\/video\/([A-Za-z0-9_-]{11})/);

    if (match) return match[1];

    // Fallback: only apply to recognised YouTube domains to avoid
    // matching arbitrary 11-char path segments on unrelated URLs.
    if (/youtube\.com|youtu\.be/.test(s)) {
        const fallback = s.match(/\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/);
        if (fallback) return fallback[1];
    }

    return null;
}

// ─── Channel Info Fetching ────────────────────────────────────────────────────
/**
 * Fetch channel name and URL for a given YouTube video ID.
 * Results are cached in localStorage for 6 hours.
 */
async function fetchChannelInfo(videoId) {
    if (!videoId) return { name: '#N/A (Invalid ID)', url: '#N/A' };

    // 1. Check local cache (with safe JSON parsing)
    const cacheKey = `${CACHE_PREFIX}${videoId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed && Date.now() < parsed.expiry) return parsed.data;
        } catch {
            localStorage.removeItem(cacheKey); // discard corrupt entry
        }
    }

    // 2. Fetch from YouTube oEmbed API via puter (CORS-free)
    const ytUrl    = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(ytUrl)}`;

    try {
        const WORKER_URL = 'https://yt-oembed-proxy.kevin0416.workers.dev';
const res = await fetch(`${WORKER_URL}?url=${encodeURIComponent(oembedUrl)}`);
        if (!res.ok) throw new Error(`oEmbed request failed: ${res.status}`);

        const data = await res.json();
        const result = {
            name: data.author_name || '#N/A',
            url:  data.author_url  || '#N/A',
        };

        // 3. Store in cache
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                data:   result,
                expiry: Date.now() + CACHE_TTL_MS,
            }));
        } catch (storageErr) {
            // localStorage may be full — log but don't break
            console.warn('Cache write failed:', storageErr);
        }

        return result;
    } catch (e) {
        console.error('fetchChannelInfo error:', e);
        return { name: '#N/A (Network Error)', url: '#N/A' };
    }
}

// ─── Row Rendering ────────────────────────────────────────────────────────────
/**
 * Create a table row safely using DOM methods (no innerHTML)
 * to prevent XSS from user-supplied URL values.
 */
function createResultRow(url, info) {
    const row = document.createElement('tr');

    // Original URL — plain text, never innerHTML
    const tdUrl = document.createElement('td');
    tdUrl.textContent = url;

    // Channel name
    const tdName = document.createElement('td');
    tdName.textContent = info.name;

    // Channel URL — anchor only for valid URLs
    const tdChannel = document.createElement('td');
    if (info.url && info.url.startsWith('http')) {
        const a = document.createElement('a');
        a.href        = info.url;
        a.textContent = info.url;
        a.target      = '_blank';
        a.rel         = 'noopener noreferrer'; // prevent tab-napping
        tdChannel.appendChild(a);
    } else {
        tdChannel.textContent = '#N/A';
    }

    row.append(tdUrl, tdName, tdChannel);
    return row;
}

// ─── Batch Processing ─────────────────────────────────────────────────────────
/**
 * Process URLs in parallel batches of BATCH_SIZE,
 * with a short delay between batches to avoid rate-limiting.
 * Returns results in original input order.
 */
async function processInBatches(urls) {
    const results = new Array(urls.length);

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);

        const settled = await Promise.allSettled(
            batch.map((url, batchIndex) => {
                const absoluteIndex = i + batchIndex;
                const vid = extractVideoId(url);
                return fetchChannelInfo(vid).then(info => ({
                    index: absoluteIndex,
                    url,
                    info,
                }));
            })
        );

        // ✅ Use batchIndex directly — never rely on settled.indexOf()
        settled.forEach((result, batchIndex) => {
            const absoluteIndex = i + batchIndex;
            if (result.status === 'fulfilled') {
                results[absoluteIndex] = result.value;
            } else {
                results[absoluteIndex] = {
                    index: absoluteIndex,
                    url:   urls[absoluteIndex],
                    info:  { name: '#N/A (Error)', url: '#N/A' },
                };
            }
        });

        const processed = Math.min(i + BATCH_SIZE, urls.length);
        statusDiv.textContent = `Processing ${processed} of ${urls.length}…`;

        if (i + BATCH_SIZE < urls.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    return results;
}
// ─── Extract Button ───────────────────────────────────────────────────────────
extractBtn.addEventListener('click', async () => {
    const lines = urlInput.value.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;

    extractBtn.disabled        = true;
    copyBtn.style.display      = 'none';
    resultsBody.innerHTML      = '';
    resultsTable.style.display = 'table';
    statusDiv.textContent      = `Starting — 0 of ${lines.length}…`;

    try {
        const results = await processInBatches(lines);

        // Render rows in original order
        const fragment = document.createDocumentFragment();
        for (const result of results) {
            if (result) fragment.appendChild(createResultRow(result.url, result.info));
        }
        resultsBody.appendChild(fragment);

        statusDiv.textContent = `Complete — ${lines.length} URL${lines.length !== 1 ? 's' : ''} processed.`;
    } catch (err) {
        console.error('Batch processing error:', err);
        statusDiv.textContent = 'An unexpected error occurred. Check the console for details.';
    } finally {
        extractBtn.disabled = false;
        if (resultsBody.children.length > 0) {
            copyBtn.style.display = 'block';
        }
    }
});

// ─── Copy Button ──────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
    const rows      = resultsBody.querySelectorAll('tr');
    const validUrls = [];

    rows.forEach(row => {
        // Read from the anchor href directly — more reliable than textContent
        const anchor = row.cells[2]?.querySelector('a');
        if (anchor?.href) validUrls.push(anchor.href);
    });

    if (validUrls.length === 0) {
        alert('No valid channel URLs found to copy.');
        return;
    }

    navigator.clipboard.writeText(validUrls.join('\n')).then(() => {
        const originalText = copyBtn.textContent;
        const originalBg   = copyBtn.style.background;

        copyBtn.textContent    = 'Copied!';
        copyBtn.style.background = '#008cc0';

        setTimeout(() => {
            copyBtn.textContent    = originalText;
            copyBtn.style.background = originalBg;
        }, 2000);
    }).catch(err => {
        console.error('Clipboard write failed:', err);
        alert('Failed to copy to clipboard. Please copy the URLs manually.');
    });
});
