if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}

const extractBtn = document.getElementById('extractBtn');
const copyBtn = document.getElementById('copyBtn');
const urlInput = document.getElementById('urlInput');
const resultsTable = document.getElementById('resultsTable');
const resultsBody = document.getElementById('resultsBody');
const statusDiv = document.getElementById('status');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extractVideoId(url) {
    if (!url) return null;
    const s = String(url).trim();
    
    let match = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || 
                s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
                s.match(/\/shorts\/([A-Za-z0-9_-]{11})/) ||
                s.match(/\/embed\/([A-Za-z0-9_-]{11})/) ||
                s.match(/\/video\/([A-Za-z0-9_-]{11})/);

    if (match) return match[1];

    const fallbackMatch = s.match(/\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/);
    return fallbackMatch ? fallbackMatch[1] : null;
}

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
    
    // Switched to AllOrigins as corsproxy.io is currently returning 403 Forbidden
    const proxiedUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(oembedUrl)}`;

    try {
        const res = await fetch(proxiedUrl);
        if (!res.ok) throw new Error('Fetch failed');
        
        const responseData = await res.json();
        // AllOrigins returns the target data as a string in the "contents" property
        const data = JSON.parse(responseData.contents);
        
        const result = { 
            name: data.author_name || '#N/A', 
            url: data.author_url || '#N/A' 
        };
        
        localStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            expiry: Date.now() + (6 * 60 * 60 * 1000)
        }));
        
        return result;
    } catch (e) {
        console.error('Error fetching data:', e);
        return { name: '#N/A (Proxy/Network Error)', url: '#N/A' };
    }
}

extractBtn.addEventListener('click', async () => {
    const lines = urlInput.value.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;

    extractBtn.disabled = true;
    copyBtn.style.display = 'none';
    resultsBody.innerHTML = '';
    resultsTable.style.display = 'table';
    
    let processedCount = 0;

    for (const url of lines) {
        processedCount++;
        statusDiv.textContent = `Processing ${processedCount} of ${lines.length}...`;
        
        const vid = extractVideoId(url);
        const info = await fetchChannelInfo(vid);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${url}</td>
            <td>${info.name}</td>
            <td>${info.url !== '#N/A' ? `<a href="${info.url}" target="_blank">${info.url}</a>` : '#N/A'}</td>
        `;
        resultsBody.appendChild(row);

        if (processedCount < lines.length) {
            await sleep(500); 
        }
    }

    statusDiv.textContent = 'Batch Processing Complete.';
    extractBtn.disabled = false;
    if (resultsBody.children.length > 0) {
        copyBtn.style.display = 'block';
    }
});

copyBtn.addEventListener('click', () => {
    const rows = resultsBody.querySelectorAll('tr');
    const validUrls = [];

    rows.forEach(row => {
        const urlCell = row.cells[2].textContent;
        if (urlCell && urlCell.startsWith('http')) {
            validUrls.push(urlCell);
        }
    });

    if (validUrls.length > 0) {
        const textToCopy = validUrls.join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            const originalBg = copyBtn.style.background;
            copyBtn.style.background = '#008cc0';
            
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = originalBg;
            }, 2000);
        });
    } else {
        alert('No valid channel URLs found to copy.');
    }
});

