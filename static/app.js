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

// App State
let currentFile = null;          // File object if uploaded
let currentFilePath = null;      // Path string if loaded locally
let currentPage = 1;
let totalPages = 1;
let activeTaskId = null;
let statusPollInterval = null;
let sliderPositionPercent = 50;  // Initial slider pos

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    setupUploadEvents();
    setupSettingsEvents();
    setupSliderEvents();
    setupPageNavigation();
    setupActionButtons();
});

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
    infoMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB | Reading...`;
    fileInfoContainer.classList.remove('hidden');
    
    // Auto populate output file name
    const dotIdx = file.name.lastIndexOf('.');
    const baseName = dotIdx !== -1 ? file.name.substring(0, dotIdx) : file.name;
    outputNameInput.value = `${baseName}_printable.pdf`;

    // Upload the file to server cache first to get preview
    uploadFileToServer(file);
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
        showError('Failed to load PDF file.');
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
        showError('Error rendering page preview.');
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

// 6. Conversion Handlers
function setupActionButtons() {
    convertBtn.addEventListener('click', startConversion);
    cancelBtn.addEventListener('click', cancelConversion);
    
    backToPreviewBtn.addEventListener('click', () => {
        conversionCompletedBox.classList.add('hidden');
        showPreviewCompare();
    });

    openFileBtn.addEventListener('click', () => {
        if (currentFilePath) {
            openConvertedFile();
        }
    });

    openFolderBtn.addEventListener('click', () => {
        if (currentFilePath) {
            openOutputFolder();
        }
    });
}

async function startConversion() {
    if (!currentFilePath) return;

    // Reset progress UI
    progressPercentageDisplay.textContent = '0%';
    progressBarFill.style.width = '0%';
    statusLog.innerHTML = '';
    addLogEntry('Initiating PDF background conversion...', 'info');

    // Show Progress panel
    compareContainer.classList.add('hidden');
    previewNav.classList.add('hidden');
    conversionProgressBox.classList.remove('hidden');

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

function showCompletedState() {
    conversionProgressBox.classList.add('hidden');
    conversionCompletedBox.classList.remove('hidden');
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
