// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}

const extractBtn = document.getElementById('extractBtn');
const urlInput = document.getElementById('urlInput');
const resultsTable = document.getElementById('resultsTable');
const resultsBody = document.getElementById('resultsBody');
const statusDiv = document.getElementById('status');

/**
 * Normalises a YouTube URL to a standard watch URL and returns the video ID.
 */
function extractVideoId(url) {
    if (!url) return null;
    const s = String(url).trim();
    let match = s.match(/[?&]v=([A-Za-z0-9_-]{11,})/) || 
                s.match(/youtu\.be\/([A-Za-z0-9_-]{11,})/) ||
                s.match(/\/shorts\/([A-Za-z0-9_-]{11,})/) ||
                s.match(/\/embed\/([A-Za-z0-9_-]{11,})/);
    return match ? match[1] : null;
}

/**
 * Ported fetch using YouTube oEmbed.
 * Uses localStorage for caching (6-hour expiry).
 */
async function fetchChannelInfo(videoId) {
    if (!videoId) return { name: '#N/A', url: '#N/A' };

    const cacheKey = `yt_oembed_${videoId}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() < parsed.expiry) return parsed.data;
    }

    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`;

    try {
        const res = await fetch(oembedUrl);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        const result = { name: data.author_name || '#N/A', url: data.author_url || '#N/A' };
        
        // Cache for 6 hours
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            expiry: Date.now() + (6 * 60 * 60 * 1000)
        }));
        
        return result;
    } catch (e) {
        return { name: '#N/A', url: '#N/A' };
    }
}

extractBtn.addEventListener('click', async () => {
    const lines = urlInput.value.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;

    extractBtn.disabled = true;
    resultsBody.innerHTML = '';
    resultsTable.style.display = 'table';
    statusDiv.textContent = 'Processing...';

    for (const url of lines) {
        const vid = extractVideoId(url);
        const info = await fetchChannelInfo(vid);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${url}</td>
            <td>${info.name}</td>
            <td><a href="${info.url}" target="_blank">${info.url}</a></td>
        `;
        resultsBody.appendChild(row);
    }

    statusDiv.textContent = 'Done.';
    extractBtn.disabled = false;
});