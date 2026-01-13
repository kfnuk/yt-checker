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
 * Normalises a YouTube URL and returns the 11-character video ID.
 */
function extractVideoId(url) {
    if (!url) return null;
    const s = String(url).trim();
    
    // 1. Try standard patterns
    let match = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || 
                s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
                s.match(/\/shorts\/([A-Za-z0-9_-]{11})/) ||
                s.match(/\/embed\/([A-Za-z0-9_-]{11})/) ||
                // Added support for the /video/ format
                s.match(/\/video\/([A-Za-z0-9_-]{11})/);

    if (match) return match[1];

    // 2. Fallback: Heuristic for any URL ending in an 11-char ID (e.g., example.com/XYZ123abcde)
    const fallbackMatch = s.match(/\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/);
    return fallbackMatch ? fallbackMatch[1] : null;
}

/**
 * Ported fetch using YouTube oEmbed via a CORS Proxy.
 */
async function fetchChannelInfo(videoId) {
    if (!videoId) return { name: '#N/A (Invalid ID)', url: '#N/A' };

    const cacheKey = `yt_oembed_${videoId}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() < parsed.expiry) return parsed.data;
    }

    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(ytUrl)}`;
    
    // Using corsproxy.io to bypass browser CORS restrictions
    const proxiedUrl = `https://corsproxy.io/?${encodeURIComponent(oembedUrl)}`;

    try {
        const res = await fetch(proxiedUrl);
        if (!res.ok) throw new Error('Fetch failed');
        
        const data = await res.json();
        const result = { 
            name: data.author_name || '#N/A', 
            url: data.author_url || '#N/A' 
        };
        
        // Cache for 6 hours
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            expiry: Date.now() + (6 * 60 * 60 * 1000)
        }));
        
        return result;
    } catch (e) {
        console.error('Error fetching data:', e);
        return { name: '#N/A (CORS/Network Error)', url: '#N/A' };
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
            <td>${info.url !== '#N/A' ? `<a href="${info.url}" target="_blank">${info.url}</a>` : '#N/A'}</td>
        `;
        resultsBody.appendChild(row);
    }

    statusDiv.textContent = 'Done.';
    extractBtn.disabled = false;
});
const copyBtn = document.getElementById('copyBtn');

// Logic to show/hide the copy button and handle the clipboard
extractBtn.addEventListener('click', async () => {
    // ... your existing extraction logic ...
    
    // Show the copy button once the loop finishes
    if (resultsBody.children.length > 0) {
        copyBtn.style.display = 'block';
    }
});

copyBtn.addEventListener('click', () => {
    const rows = resultsBody.querySelectorAll('tr');
    const validUrls = [];

    rows.forEach(row => {
        const urlCell = row.cells[2].textContent;
        // Only collect if it is a valid URL (not #N/A)
        if (urlCell && urlCell.startsWith('http')) {
            validUrls.push(urlCell);
        }
    });

    if (validUrls.length > 0) {
        const textToCopy = validUrls.join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.style.background = '#009432';
            
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '';
            }, 2000);
        });
    } else {
        alert('No valid channel URLs found to copy.');
    }
});