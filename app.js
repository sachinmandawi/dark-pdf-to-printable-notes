// DOM Elements
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const localPathInput = document.getElementById('local-path');
const loadPathBtn = document.getElementById('load-path-btn');
const fileInfoContainer = document.getElementById('file-info-container');
const infoName = document.getElementById('info-name');
const infoMeta = document.getElementById('info-meta');
const removeFileBtn = document.getElementById('remove-file-btn');

const modeSelect = document.getElementById('mode-select');
const dpiSelect = document.getElementById('dpi-select');
const bgThreshold = document.getElementById('bg-threshold');
const bgThresholdVal = document.getElementById('bg-threshold-val');
const bgThresholdRow = document.getElementById('bg-threshold-row');
const colorIntensity = document.getElementById('color-intensity');
const colorIntensityVal = document.getElementById('color-intensity-val');
const pageRangeInput = document.getElementById('page-range');
const outputNameInput = document.getElementById('output-name');
const convertBtn = document.getElementById('convert-btn');

const previewPlaceholder = document.getElementById('preview-placeholder');
const previewLoading = document.getElementById('preview-loading');
const compareContainer = document.getElementById('compare-container');
const compareWrapper = document.getElementById('compare-wrapper');
const imgAfter = document.getElementById('img-after-el');
const imgBefore = document.getElementById('img-before-el');
const imgBeforeWrapper = document.getElementById('img-before-wrapper');
const sliderBar = document.getElementById('compare-slider-bar');
const previewNav = document.getElementById('preview-nav');
const currentPageNumSpan = document.getElementById('current-page-num');
const totalPageNumSpan = document.getElementById('total-page-num');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');

const conversionProgressBox = document.getElementById('conversion-progress-box');
const progressStatusTitle = document.getElementById('progress-status-title');
const progressStatusSub = document.getElementById('progress-status-sub');
const progressPercentageDisplay = document.getElementById('progress-percentage-display');
const progressBarFill = document.getElementById('progress-bar-fill');
const statusLog = document.getElementById('status-log');
const cancelBtn = document.getElementById('cancel-btn');

const conversionCompletedBox = document.getElementById('conversion-completed-box');
const openFileBtn = document.getElementById('open-file-btn');
const openFolderBtn = document.getElementById('open-folder-btn');
const backToPreviewBtn = document.getElementById('back-to-preview-btn');

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

// App State
let currentFile = null;          // File object if uploaded
let currentFilePath = null;      // Path string if loaded locally
let currentPage = 1;
let totalPages = 1;
let activeTaskId = null;
let statusPollInterval = null;
let sliderPositionPercent = 50;  // Initial slider pos

let isClientSideMode = false;    // Detects if running client-side-only (e.g. GitHub Pages)
let clientPdfDoc = null;         // PDF.js document object
let clientFileBytes = null;      // ArrayBuffer of PDF
let clientPdfBlob = null;        // Blob representing final compiled PDF

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    await detectMode();
    setupUploadEvents();
    setupSettingsEvents();
    setupSliderEvents();
    setupPageNavigation();
    setupActionButtons();
});

// 0. Detect whether running locally with FastAPI server, or on static hosting (Browser-Only mode)
async function detectMode() {
    // If hostname is not localhost, default to browser mode (since cloud cannot access local filesystem)
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        try {
            // Attempt to ping local server API
            const response = await fetch('/api/metadata?path=test');
            isClientSideMode = false;
            console.log("FastAPI local server detected. Running in Full Integration Mode.");
        } catch (e) {
            isClientSideMode = true;
            console.log("FastAPI backend offline. Switching to Browser-Only Mode.");
        }
    } else {
        isClientSideMode = true;
        console.log("Running in Browser-Only Mode (Static Host/GitHub Pages).");
    }

    // Adjust UI elements for Browser-Only mode
    if (isClientSideMode) {
        const divider = document.querySelector('.divider');
        const localPathGroup = document.querySelector('.input-group');
        if (divider) divider.classList.add('hidden');
        if (localPathGroup) localPathGroup.classList.add('hidden');
        
        openFolderBtn.classList.add('hidden');
        openFileBtn.innerHTML = '📥 Download Converted PDF';
    }
}

// 1. Upload & Path Selection Handlers
function setupUploadEvents() {
    uploadZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    loadPathBtn.addEventListener('click', () => {
        const path = localPathInput.value.trim();
        if (path) {
            handleLocalPathSelect(path);
        }
    });

    removeFileBtn.addEventListener('click', () => {
        resetFileSelection();
    });
}

function handleFileSelect(file) {
    resetFileSelection();
    currentFile = file;
    infoName.textContent = file.name;
    infoMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB | Loading...`;
    fileInfoContainer.classList.remove('hidden');
    
    // Auto populate output file name
    const dotIdx = file.name.lastIndexOf('.');
    const baseName = dotIdx !== -1 ? file.name.substring(0, dotIdx) : file.name;
    outputNameInput.value = `${baseName}_printable.pdf`;

    if (isClientSideMode) {
        // Read file local bytes to process inside browser
        const reader = new FileReader();
        reader.onload = async function() {
            clientFileBytes = this.result;
            const typedarray = new Uint8Array(clientFileBytes);
            try {
                clientPdfDoc = await pdfjsLib.getDocument({data: typedarray}).promise;
                totalPages = clientPdfDoc.numPages;
                infoMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB | ${totalPages} Pages (Browser-Only Mode)`;
                convertBtn.disabled = false;
                loadPreview();
            } catch (err) {
                console.error(err);
                showError("Failed to parse PDF file inside your browser.");
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        // Upload the file to local server cache
        uploadFileToServer(file);
    }
}

function handleLocalPathSelect(path) {
    resetFileSelection();
    currentFilePath = path;
    infoName.textContent = path.split('\\').pop().split('/').pop();
    infoMeta.textContent = `Local File | Loading metadata...`;
    fileInfoContainer.classList.remove('hidden');
    
    // Auto populate output file name
    const name = path.split('\\').pop().split('/').pop();
    const dotIdx = name.lastIndexOf('.');
    const baseName = dotIdx !== -1 ? name.substring(0, dotIdx) : name;
    outputNameInput.value = `${baseName}_printable.pdf`;

    loadLocalMetadata(path);
}

function resetFileSelection() {
    currentFile = null;
    currentFilePath = null;
    currentPage = 1;
    totalPages = 1;
    fileInput.value = '';
    localPathInput.value = '';
    outputNameInput.value = '';
    fileInfoContainer.classList.add('hidden');
    convertBtn.disabled = true;
    
    clientPdfDoc = null;
    clientFileBytes = null;
    clientPdfBlob = null;
    
    // Reset view states
    previewPlaceholder.classList.remove('hidden');
    previewLoading.classList.add('hidden');
    compareContainer.classList.add('hidden');
    previewNav.classList.add('hidden');
    conversionProgressBox.classList.add('hidden');
    conversionCompletedBox.classList.add('hidden');
}

// 2. Settings Event Handlers
function setupSettingsEvents() {
    // Mode visibility toggle for thresholds
    modeSelect.addEventListener('change', () => {
        if (modeSelect.value === 'smart') {
            bgThresholdRow.classList.remove('hidden');
        } else {
            bgThresholdRow.classList.add('hidden');
        }
        triggerPreviewRefresh();
    });

    dpiSelect.addEventListener('change', triggerPreviewRefresh);

    bgThreshold.addEventListener('input', (e) => {
        bgThresholdVal.textContent = e.target.value;
    });
    bgThreshold.addEventListener('change', triggerPreviewRefresh);

    colorIntensity.addEventListener('input', (e) => {
        colorIntensityVal.textContent = e.target.value;
    });
    colorIntensity.addEventListener('change', triggerPreviewRefresh);
}

function triggerPreviewRefresh() {
    if (currentFile || currentFilePath) {
        loadPreview();
    }
}

// 3. Compare Slider Events
function setupSliderEvents() {
    let isDragging = false;

    const startDrag = (e) => {
        isDragging = true;
        e.preventDefault();
    };

    const stopDrag = () => {
        isDragging = false;
    };

    const drag = (e) => {
        if (!isDragging) return;
        
        const rect = compareWrapper.getBoundingClientRect();
        let clientX = e.clientX;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
        }
        
        let positionX = clientX - rect.left;
        let pct = (positionX / rect.width) * 100;
        
        // Clamp between 0 and 100
        pct = Math.max(0, Math.min(100, pct));
        sliderPositionPercent = pct;
        
        // Apply position
        imgBeforeWrapper.style.width = pct + '%';
        sliderBar.style.left = pct + '%';
    };

    sliderBar.addEventListener('mousedown', startDrag);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('mousemove', drag);

    sliderBar.addEventListener('touchstart', startDrag);
    window.addEventListener('touchend', stopDrag);
    window.addEventListener('touchmove', drag);

    // Sync image widths on load and container resize
    imgAfter.addEventListener('load', () => {
        syncSliderDimensions();
    });
    window.addEventListener('resize', syncSliderDimensions);
}

function syncSliderDimensions() {
    if (compareContainer.classList.contains('hidden')) return;
    
    const w = imgAfter.clientWidth;
    const h = imgAfter.clientHeight;
    
    imgBefore.style.width = w + 'px';
    imgBefore.style.height = h + 'px';
    imgBeforeWrapper.style.height = h + 'px';
    
    // Maintain slider percentage
    imgBeforeWrapper.style.width = sliderPositionPercent + '%';
    sliderBar.style.left = sliderPositionPercent + '%';
}

// 4. Page Navigation
function setupPageNavigation() {
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadPreview();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadPreview();
        }
    });
}

function updatePageControls() {
    currentPageNumSpan.textContent = currentPage;
    totalPageNumSpan.textContent = totalPages;
    prevPageBtn.disabled = (currentPage === 1);
    nextPageBtn.disabled = (currentPage === totalPages);
}

// 5. Actions / API Communications
async function uploadFileToServer(file) {
    showPreviewLoading();
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        const data = await response.json();
        
        currentFilePath = data.filepath;
        totalPages = data.total_pages;
        infoMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB | ${totalPages} Pages`;
        
        convertBtn.disabled = false;
        loadPreview();
    } catch (err) {
        console.error(err);
        showError('Failed to upload PDF file to server.');
        resetFileSelection();
    }
}

async function loadLocalMetadata(path) {
    showPreviewLoading();
    try {
        const response = await fetch(`/api/metadata?path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error('Failed to read local metadata');
        const data = await response.json();
        
        totalPages = data.total_pages;
        infoMeta.textContent = `${data.size_mb.toFixed(2)} MB | ${totalPages} Pages`;
        
        convertBtn.disabled = false;
        loadPreview();
    } catch (err) {
        console.error(err);
        showError('Invalid file path or error reading file metadata.');
        resetFileSelection();
    }
}

async function loadPreview() {
    showPreviewLoading();
    
    if (isClientSideMode) {
        // Run Client-Side Preview
        try {
            const pageObj = await clientPdfDoc.getPage(currentPage);
            
            // 1. Render Original (1.2 scale)
            const viewportOrig = pageObj.getViewport({scale: 1.2});
            const canvasOrig = document.createElement('canvas');
            canvasOrig.width = viewportOrig.width;
            canvasOrig.height = viewportOrig.height;
            const ctxOrig = canvasOrig.getContext('2d');
            await pageObj.render({canvasContext: ctxOrig, viewport: viewportOrig}).promise;
            const base64Orig = canvasOrig.toDataURL('image/png');
            
            // 2. Render Inverted (at target DPI scale)
            const scaleDPI = parseInt(dpiSelect.value) / 72.0;
            const viewportTarget = pageObj.getViewport({scale: scaleDPI});
            const canvasTarget = document.createElement('canvas');
            canvasTarget.width = viewportTarget.width;
            canvasTarget.height = viewportTarget.height;
            const ctxTarget = canvasTarget.getContext('2d');
            await pageObj.render({canvasContext: ctxTarget, viewport: viewportTarget}).promise;
            
            // 3. Process pixels
            const imgData = ctxTarget.getImageData(0, 0, canvasTarget.width, canvasTarget.height);
            invertPixelsClientSide(
                imgData.data,
                modeSelect.value,
                parseInt(bgThreshold.value),
                parseInt(colorIntensity.value)
            );
            ctxTarget.putImageData(imgData, 0, 0);
            const base64Inv = canvasTarget.toDataURL('image/png');
            
            // 4. Update elements
            imgBefore.src = base64Orig;
            imgAfter.src = base64Inv;
            
            showPreviewCompare();
            updatePageControls();
        } catch (err) {
            console.error(err);
            showError("Failed to render page preview inside browser.");
        }
    } else {
        // Run Server-Side Preview
        const params = new URLSearchParams({
            filepath: currentFilePath,
            page: currentPage,
            mode: modeSelect.value,
            dpi: dpiSelect.value,
            threshold: bgThreshold.value,
            intensity: colorIntensity.value
        });

        try {
            const response = await fetch(`/api/preview?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to fetch preview');
            const data = await response.json();
            
            imgBefore.src = `data:image/png;base64,${data.before}`;
            imgAfter.src = `data:image/png;base64,${data.after}`;
            
            showPreviewCompare();
            updatePageControls();
        } catch (err) {
            console.error(err);
            showError('Error rendering page preview from server.');
        }
    }
}

function showPreviewLoading() {
    previewPlaceholder.classList.add('hidden');
    previewLoading.classList.remove('hidden');
    compareContainer.classList.add('hidden');
    previewNav.classList.add('hidden');
    conversionProgressBox.classList.add('hidden');
    conversionCompletedBox.classList.add('hidden');
}

function showPreviewCompare() {
    previewLoading.classList.add('hidden');
    compareContainer.classList.remove('hidden');
    previewNav.classList.remove('hidden');
    
    // Sync slider layouts
    setTimeout(syncSliderDimensions, 50);
}

function showError(msg) {
    alert(msg);
}

function invertPixelsClientSide(data, mode, threshold, intensity) {
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i+1];
        let b = data[i+2];
        
        let max_c = Math.max(r, g, b);
        
        if (mode === 'grayscale') {
            let y = 0.299 * r + 0.587 * g + 0.114 * b;
            let inverted_y = 255.0 - y;
            if (inverted_y > threshold) {
                inverted_y = 255.0;
            }
            let scale = intensity / 110.0;
            inverted_y = Math.max(0, Math.min(255, inverted_y * scale));
            
            data[i] = inverted_y;
            data[i+1] = inverted_y;
            data[i+2] = inverted_y;
        } else if (mode === 'simple') {
            data[i] = 255 - r;
            data[i+1] = 255 - g;
            data[i+2] = 255 - b;
        } else { // smart mode
            let min_c = Math.min(r, g, b);
            let chroma = max_c - min_c;
            
            // 1. Color mask: 1.0 for colored, 0.0 for neutral
            let color_mask = (chroma - 10.0) / 30.0;
            if (color_mask < 0) color_mask = 0;
            if (color_mask > 1) color_mask = 1;
            
            // 2. Inverted Neutral (white text -> black, black background -> white)
            let neutral_r = 255.0 - r;
            let neutral_g = 255.0 - g;
            let neutral_b = 255.0 - b;
            let max_neutral = Math.max(neutral_r, neutral_g, neutral_b);
            if (max_neutral > threshold) {
                neutral_r = 255.0;
                neutral_g = 255.0;
                neutral_b = 255.0;
            }
            
            // 3. Color preservation:
            // Scale original color based on intensity slider (default 110 means scale=1.0)
            let scale = intensity / 110.0;
            if (scale > 1) scale = 1.0;
            
            let scaled_r = r * scale;
            let scaled_g = g * scale;
            let scaled_b = b * scale;
            let scaled_max_c = max_c * scale;
            
            // Background compensation
            let bg_comp = 255.0 - scaled_max_c;
            let color_r = Math.max(0, Math.min(255, scaled_r + bg_comp));
            let color_g = Math.max(0, Math.min(255, scaled_g + bg_comp));
            let color_b = Math.max(0, Math.min(255, scaled_b + bg_comp));
            
            // 4. Combine
            data[i] = Math.max(0, Math.min(255, (1.0 - color_mask) * neutral_r + color_mask * color_r));
            data[i+1] = Math.max(0, Math.min(255, (1.0 - color_mask) * neutral_g + color_mask * color_g));
            data[i+2] = Math.max(0, Math.min(255, (1.0 - color_mask) * neutral_b + color_mask * color_b));
        }
    }
}

// 6. Conversion Handlers
function setupActionButtons() {
    convertBtn.addEventListener('click', startConversion);
    cancelBtn.addEventListener('click', cancelConversion);
    
    backToPreviewBtn.addEventListener('click', () => {
        conversionCompletedBox.classList.add('hidden');
        showPreviewCompare();
    });

    openFileBtn.addEventListener('click', () => {
        if (isClientSideMode) {
            triggerClientSideDownload();
        } else {
            openConvertedFile();
        }
    });

    openFolderBtn.addEventListener('click', () => {
        if (!isClientSideMode) {
            openOutputFolder();
        }
    });
}

// Parse Page Range String Client-Side
function parsePageRangeClient(rangeStr, maxPages) {
    if (!rangeStr || rangeStr.trim().toLowerCase() === 'all') {
        return Array.from({length: maxPages}, (_, i) => i);
    }
    
    const pages = new Set();
    const parts = rangeStr.split(',');
    
    parts.forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
            const [start, end] = part.split('-');
            const sVal = parseInt(start.trim());
            const eVal = parseInt(end.trim());
            for (let p = sVal; p <= eVal; p++) {
                if (p >= 1 && p <= maxPages) {
                    pages.add(p - 1);
                }
            }
        } else {
            const p = parseInt(part);
            if (p >= 1 && p <= maxPages) {
                pages.add(p - 1);
            }
        }
    });
    
    return Array.from(pages).sort((a, b) => a - b);
}

async function startConversion() {
    // Reset progress UI
    progressPercentageDisplay.textContent = '0%';
    progressBarFill.style.width = '0%';
    statusLog.innerHTML = '';
    
    compareContainer.classList.add('hidden');
    previewNav.classList.add('hidden');
    conversionProgressBox.classList.remove('hidden');

    if (isClientSideMode) {
        // Run Client-Side Conversion
        addLogEntry('Initiating browser-only background conversion (no server)...', 'info');
        
        const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
        if (pages.length === 0) {
            addLogEntry('Error: Page range is invalid or matched 0 pages.', 'error');
            progressStatusTitle.textContent = 'Conversion Failed';
            return;
        }

        addLogEntry(`Selected pages to convert: ${pages.map(p => p+1).join(', ')}`, 'info');
        
        // Spawn async processor
        setTimeout(async () => {
            try {
                const { jsPDF } = window.jspdf;
                let pdfDocOut = null;
                
                for (let idx = 0; idx < pages.length; idx++) {
                    const pageNum = pages[idx];
                    
                    // Update UI
                    const pct = Math.round((idx / pages.length) * 90);
                    progressPercentageDisplay.textContent = `${pct}%`;
                    progressBarFill.style.width = `${pct}%`;
                    progressStatusTitle.textContent = `Processing page ${pageNum + 1}...`;
                    progressStatusSub.textContent = `Slide ${idx + 1} of ${pages.length}`;
                    
                    addLogEntry(`Rendering page ${pageNum + 1}...`, 'info');
                    
                    const pageObj = await clientPdfDoc.getPage(pageNum + 1);
                    const scaleDPI = parseInt(dpiSelect.value) / 72.0;
                    const viewport = pageObj.getViewport({scale: scaleDPI});
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext('2d');
                    await pageObj.render({canvasContext: ctx, viewport: viewport}).promise;
                    
                    // Process Inversion
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    invertPixelsClientSide(
                        imgData.data,
                        modeSelect.value,
                        parseInt(bgThreshold.value),
                        parseInt(colorIntensity.value)
                    );
                    ctx.putImageData(imgData, 0, 0);
                    
                    // Compress to JPEG
                    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    const w = canvas.width;
                    const h = canvas.height;
                    
                    if (idx === 0) {
                        pdfDocOut = new jsPDF({
                            orientation: w > h ? 'l' : 'p',
                            unit: 'px',
                            format: [w, h],
                            compress: true
                        });
                    } else {
                        pdfDocOut.addPage([w, h], w > h ? 'l' : 'p');
                    }
                    
                    pdfDocOut.addImage(imgDataUrl, 'JPEG', 0, 0, w, h);
                    addLogEntry(`Rendered slide ${pageNum + 1} successfully.`, 'info');
                }
                
                progressPercentageDisplay.textContent = '95%';
                progressBarFill.style.width = '95%';
                progressStatusTitle.textContent = 'Compiling PDF document...';
                addLogEntry('Encoding pages to printable PDF format...', 'info');
                
                // Save bytes locally
                clientPdfBlob = pdfDocOut.output('blob');
                
                progressPercentageDisplay.textContent = '100%';
                progressBarFill.style.width = '100%';
                progressStatusTitle.textContent = 'Done!';
                progressStatusSub.textContent = 'Conversion successful';
                addLogEntry('PDF notes generated successfully!', 'success');
                
                // Automatically download file on completion
                triggerClientSideDownload();
                
                setTimeout(showCompletedState, 300);
            } catch (err) {
                console.error(err);
                addLogEntry(`Browser error during conversion: ${err.message}`, 'error');
                progressStatusTitle.textContent = 'Conversion Failed';
            }
        }, 100);

    } else {
        // Run Server-Side Conversion
        addLogEntry('Initiating PDF background conversion on local server...', 'info');
        
        const params = {
            filepath: currentFilePath,
            mode: modeSelect.value,
            dpi: dpiSelect.value,
            threshold: parseInt(bgThreshold.value),
            intensity: parseInt(colorIntensity.value),
            page_range: pageRangeInput.value.trim(),
            output_name: outputNameInput.value.trim()
        };

        try {
            const response = await fetch('/api/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            if (!response.ok) throw new Error('Failed to start conversion');
            const data = await response.json();
            
            activeTaskId = data.task_id;
            addLogEntry(`Task created with ID: ${activeTaskId}`, 'info');
            
            // Start polling
            statusPollInterval = setInterval(pollConversionStatus, 800);
        } catch (err) {
            console.error(err);
            addLogEntry(`Failed to start task: ${err.message}`, 'error');
        }
    }
}

async function pollConversionStatus() {
    if (!activeTaskId) return;

    try {
        const response = await fetch(`/api/status/${activeTaskId}`);
        if (!response.ok) throw new Error('Status poll failed');
        const data = await response.json();

        // Update progress bar
        const progress = data.progress || 0;
        progressPercentageDisplay.textContent = `${progress}%`;
        progressBarFill.style.width = `${progress}%`;
        
        // Update statuses
        progressStatusTitle.textContent = data.title || 'Processing PDF...';
        progressStatusSub.textContent = data.message || '';

        // Add logs
        if (data.logs && data.logs.length > 0) {
            data.logs.forEach(log => {
                addLogEntry(log.text, log.level);
            });
        }

        if (data.status === 'success') {
            clearInterval(statusPollInterval);
            addLogEntry('Task completed successfully!', 'success');
            setTimeout(showCompletedState, 500);
        } else if (data.status === 'failed') {
            clearInterval(statusPollInterval);
            addLogEntry(`Task failed: ${data.error}`, 'error');
            progressStatusTitle.textContent = 'Conversion Failed';
        }
    } catch (err) {
        console.error(err);
    }
}

function addLogEntry(text, level = 'info') {
    const entry = document.createElement('div');
    entry.className = `status-log-entry ${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    statusLog.appendChild(entry);
    statusLog.scrollTop = statusLog.scrollHeight;
}

async function cancelConversion() {
    if (isClientSideMode) {
        // Just reload preview page
        conversionProgressBox.classList.add('hidden');
        showPreviewCompare();
    } else {
        if (!activeTaskId) return;
        try {
            const response = await fetch(`/api/cancel/${activeTaskId}`, { method: 'POST' });
            if (response.ok) {
                clearInterval(statusPollInterval);
                addLogEntry('Task cancelled by user.', 'warning');
                progressStatusTitle.textContent = 'Conversion Cancelled';
                setTimeout(() => {
                    conversionProgressBox.classList.add('hidden');
                    showPreviewCompare();
                }, 1500);
            }
        } catch (err) {
            console.error(err);
        }
    }
}

function showCompletedState() {
    conversionProgressBox.classList.add('hidden');
    conversionCompletedBox.classList.remove('hidden');
}

function triggerClientSideDownload() {
    if (!clientPdfBlob) return;
    
    const outputName = outputNameInput.value.trim() || 'notes_printable.pdf';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(clientPdfBlob);
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLogEntry(`Downloaded compiled file: ${outputName}`, 'success');
}

async function openConvertedFile() {
    const outputName = outputNameInput.value.trim();
    if (!outputName) return;

    try {
        const response = await fetch(`/api/open-file?output_name=${encodeURIComponent(outputName)}`);
        if (!response.ok) throw new Error('Failed to open file');
    } catch (err) {
        alert('Could not open file directly on your system.');
    }
}

async function openOutputFolder() {
    try {
        const response = await fetch('/api/open-folder');
        if (!response.ok) throw new Error('Failed to open folder');
    } catch (err) {
        alert('Could not open folder directly on your system.');
    }
}
