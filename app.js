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
const textContrast = document.getElementById('text-contrast');
const textContrastVal = document.getElementById('text-contrast-val');
const removeLogoCheckbox = document.getElementById('remove-logo-checkbox');
const pageRangeInput = document.getElementById('page-range');
const outputNameInput = document.getElementById('output-name');
const slidesSelect = document.getElementById('slides-select');
const slideScale = document.getElementById('slide-scale');
const slideScaleVal = document.getElementById('slide-scale-val');
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
const currentPageInput = document.getElementById('current-page-input');
const drawHintBadge = document.getElementById('draw-hint-badge');
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

// Drawing Selection Elements
const boxesContainer = document.getElementById('boxes-container');
const drawModeBtn = document.getElementById('draw-mode-btn');
const clearBoxesBtn = document.getElementById('clear-boxes-btn');
const drawControlsBar = document.getElementById('draw-controls-bar');

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

// Drawing Selection State
let isDrawMode = false;
let pageBoxes = {}; // pageNumber (1-based) -> Array of [x1, y1, x2, y2] percentages
let activeAction = null; // 'drawing', 'moving', 'resizing'
let activeBoxIndex = -1;
let dragStart = { x: 0, y: 0 };
let boxOriginals = { x1: 0, y1: 0, x2: 0, y2: 0 };
let tempBoxEl = null;
let selectedBoxIndex = null;

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    await detectMode();
    setupUploadEvents();
    setupSettingsEvents();
    setupSliderEvents();
    setupPageNavigation();
    setupDrawingEvents(); // Initialize drawing overlay
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
    
    // Clear boxes state
    pageBoxes = {};
    isDrawMode = false;
    if (drawModeBtn) {
        drawModeBtn.classList.remove('active');
        drawModeBtn.style.background = '';
        drawModeBtn.textContent = '🎨 Draw Box';
    }
    if (drawHintBadge) {
        drawHintBadge.classList.add('hidden');
    }
    if (boxesContainer) {
        boxesContainer.classList.add('hidden');
        boxesContainer.innerHTML = '';
        boxesContainer.style.pointerEvents = 'none';
    }
    if (clearBoxesBtn) {
        clearBoxesBtn.disabled = true;
    }
    if (drawControlsBar) {
        drawControlsBar.classList.add('hidden');
    }
    
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

    textContrast.addEventListener('input', (e) => {
        textContrastVal.textContent = e.target.value + '%';
    });
    textContrast.addEventListener('change', triggerPreviewRefresh);

    slideScale.addEventListener('input', (e) => {
        slideScaleVal.textContent = e.target.value + '%';
    });
    slideScale.addEventListener('change', triggerPreviewRefresh);

    slidesSelect.addEventListener('change', () => {
        currentPage = 1;
        triggerPreviewRefresh();
    });

    if (removeLogoCheckbox) {
        removeLogoCheckbox.addEventListener('change', triggerPreviewRefresh);
    }
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
    
    if (compareWrapper) {
        compareWrapper.style.width = w + 'px';
        compareWrapper.style.height = h + 'px';
    }
    
    imgBefore.style.width = w + 'px';
    imgBefore.style.height = h + 'px';
    imgBeforeWrapper.style.height = h + 'px';
    
    // Maintain slider percentage
    imgBeforeWrapper.style.width = sliderPositionPercent + '%';
    sliderBar.style.left = sliderPositionPercent + '%';
    
    // Sync selection boxes
    if (boxesContainer) {
        drawStoredBoxes();
    }
}

// 4. Page Navigation
function setupPageNavigation() {
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            selectedBoxIndex = null;
            loadPreview();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const slidesPerPage = parseInt(slidesSelect.value);
        const slideScaleValPct = parseInt(slideScale.value);
        const isGrid = (slidesPerPage > 1 || slideScaleValPct < 100);
        const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
        let maxVal = 1;
        if (isDrawMode || !isGrid) {
            maxVal = pages.length;
        } else {
            maxVal = Math.ceil(pages.length / slidesPerPage);
        }
        if (currentPage < maxVal) {
            currentPage++;
            selectedBoxIndex = null;
            loadPreview();
        }
    });

    if (currentPageInput) {
        const handlePageInput = () => {
            let val = parseInt(currentPageInput.value);
            if (isNaN(val)) {
                currentPageInput.value = currentPage;
                return;
            }
            const slidesPerPage = parseInt(slidesSelect.value);
            const slideScaleValPct = parseInt(slideScale.value);
            const isGrid = (slidesPerPage > 1 || slideScaleValPct < 100);
            const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
            let maxVal = 1;
            if (isDrawMode || !isGrid) {
                maxVal = pages.length;
            } else {
                maxVal = Math.ceil(pages.length / slidesPerPage);
            }
            val = Math.max(1, Math.min(maxVal, val));
            if (val !== currentPage) {
                currentPage = val;
                selectedBoxIndex = null;
                loadPreview();
            } else {
                currentPageInput.value = currentPage;
            }
        };

        currentPageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handlePageInput();
                currentPageInput.blur();
            }
        });

        currentPageInput.addEventListener('change', () => {
            handlePageInput();
        });
    }
}

function updatePageControls() {
    const slidesPerPage = parseInt(slidesSelect.value);
    const slideScaleValPct = parseInt(slideScale.value);
    const isGrid = (slidesPerPage > 1 || slideScaleValPct < 100);
    const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
    let maxVal = 1;
    if (isDrawMode || !isGrid) {
        maxVal = pages.length;
    } else {
        maxVal = Math.ceil(pages.length / slidesPerPage);
    }
    
    // Clamp currentPage just in case
    if (currentPage > maxVal) currentPage = maxVal || 1;
    if (currentPage < 1) currentPage = 1;

    if (currentPageInput) {
        currentPageInput.value = currentPage;
        currentPageInput.max = maxVal || 1;
        currentPageInput.disabled = (maxVal <= 1);
    }
    totalPageNumSpan.textContent = maxVal || 1;
    prevPageBtn.disabled = (currentPage === 1);
    nextPageBtn.disabled = (currentPage >= maxVal);
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
    
    const slidesPerPage = parseInt(slidesSelect.value);
    const slideScaleValPct = parseInt(slideScale.value);
    const dpi = parseInt(dpiSelect.value);
    const isGrid = (slidesPerPage > 1 || slideScaleValPct < 100);
    
    if (isClientSideMode) {
        try {
            if (isDrawMode || !isGrid) {
                // Single slide preview
                const pageObj = await clientPdfDoc.getPage(currentPage);
                
                const viewportOrig = pageObj.getViewport({scale: 1.2});
                const canvasOrig = document.createElement('canvas');
                canvasOrig.width = viewportOrig.width;
                canvasOrig.height = viewportOrig.height;
                const ctxOrig = canvasOrig.getContext('2d');
                await pageObj.render({canvasContext: ctxOrig, viewport: viewportOrig}).promise;
                const base64Orig = canvasOrig.toDataURL('image/png');
                
                const scaleDPI = dpi / 72.0;
                const viewportTarget = pageObj.getViewport({scale: scaleDPI});
                const canvasTarget = document.createElement('canvas');
                canvasTarget.width = viewportTarget.width;
                canvasTarget.height = viewportTarget.height;
                const ctxTarget = canvasTarget.getContext('2d');
                await pageObj.render({canvasContext: ctxTarget, viewport: viewportTarget}).promise;
                
                const imgData = ctxTarget.getImageData(0, 0, canvasTarget.width, canvasTarget.height);
                invertPixelsClientSide(
                    imgData.data,
                    modeSelect.value,
                    parseInt(bgThreshold.value),
                    parseInt(colorIntensity.value),
                    parseInt(textContrast.value),
                    removeLogoCheckbox ? removeLogoCheckbox.checked : false,
                    pageBoxes[currentPage],
                    imgData.width,
                    imgData.height
                );
                ctxTarget.putImageData(imgData, 0, 0);
                const base64Inv = canvasTarget.toDataURL('image/png');
                
                imgBefore.src = base64Orig;
                imgAfter.src = base64Inv;
                
                showPreviewCompare();
                updatePageControls();
            } else {
                // Client-side grid preview on A4 canvas
                const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
                const startIndex = (currentPage - 1) * slidesPerPage;
                const endIndex = Math.min(pages.length, currentPage * slidesPerPage);
                const sheetPages = pages.slice(startIndex, endIndex);
                
                if (sheetPages.length === 0) {
                    showError("No slides found in the selected range to preview.");
                    return;
                }
                
                const layouts = {
                    1: { cols: 1, rows: 1, orient: 'l' },
                    2: { cols: 1, rows: 2, orient: 'p' },
                    3: { cols: 1, rows: 3, orient: 'p' },
                    4: { cols: 2, rows: 2, orient: 'p' },
                    6: { cols: 2, rows: 3, orient: 'p' },
                    8: { cols: 2, rows: 4, orient: 'p' },
                    10: { cols: 2, rows: 5, orient: 'p' }
                };
                const layout = layouts[slidesPerPage] || { cols: 1, rows: 1, orient: 'l' };
                const cols = layout.cols;
                const rows = layout.rows;
                const orient = layout.orient;
                
                // Render A4 sheet at 100 DPI
                const a4W = Math.round(8.27 * 100);
                const a4H = Math.round(11.69 * 100);
                const pageW = orient === 'l' ? a4H : a4W;
                const pageH = orient === 'l' ? a4W : a4H;
                
                const canvasPageOrig = document.createElement('canvas');
                canvasPageOrig.width = pageW;
                canvasPageOrig.height = pageH;
                const ctxPageOrig = canvasPageOrig.getContext('2d');
                ctxPageOrig.fillStyle = '#ffffff';
                ctxPageOrig.fillRect(0, 0, pageW, pageH);
                
                const canvasPageInv = document.createElement('canvas');
                canvasPageInv.width = pageW;
                canvasPageInv.height = pageH;
                const ctxPageInv = canvasPageInv.getContext('2d');
                ctxPageInv.fillStyle = '#ffffff';
                ctxPageInv.fillRect(0, 0, pageW, pageH);
                
                const marginX = Math.round(0.04 * pageW);
                const marginY = Math.round(0.04 * pageH);
                const gapX = Math.round(0.02 * pageW);
                const gapY = Math.round(0.02 * pageH);
                
                const usableW = pageW - 2 * marginX - (cols - 1) * gapX;
                const usableH = pageH - 2 * marginY - (rows - 1) * gapY;
                
                const cellW = Math.floor(usableW / cols);
                const cellH = Math.floor(usableH / rows);
                
                let fitW = 0, fitH = 0;
                let calculatedFit = false;
                
                for (let idx = 0; idx < sheetPages.length; idx++) {
                    const pageNum = sheetPages[idx];
                    const pageObj = await clientPdfDoc.getPage(pageNum + 1);
                    
                    const scaleDPI = 100 / 72.0;
                    const viewport = pageObj.getViewport({scale: scaleDPI});
                    
                    const canvasSlideOrig = document.createElement('canvas');
                    canvasSlideOrig.width = viewport.width;
                    canvasSlideOrig.height = viewport.height;
                    const ctxSlideOrig = canvasSlideOrig.getContext('2d');
                    await pageObj.render({canvasContext: ctxSlideOrig, viewport: viewport}).promise;
                    
                    if (!calculatedFit) {
                        const origAspect = viewport.width / viewport.height;
                        const targetAspect = cellW / cellH;
                        if (origAspect > targetAspect) {
                            fitW = cellW;
                            fitH = Math.floor(cellW / origAspect);
                        } else {
                            fitH = cellH;
                            fitW = Math.floor(cellH * origAspect);
                        }
                        const scaleFactor = slideScaleValPct / 100.0;
                        fitW = Math.floor(fitW * scaleFactor);
                        fitH = Math.floor(fitH * scaleFactor);
                        calculatedFit = true;
                    }
                    
                    const canvasSlideInv = document.createElement('canvas');
                    canvasSlideInv.width = viewport.width;
                    canvasSlideInv.height = viewport.height;
                    const ctxSlideInv = canvasSlideInv.getContext('2d');
                    ctxSlideInv.drawImage(canvasSlideOrig, 0, 0);
                    
                    const imgData = ctxSlideInv.getImageData(0, 0, viewport.width, viewport.height);
                    invertPixelsClientSide(
                        imgData.data,
                        modeSelect.value,
                        parseInt(bgThreshold.value),
                        parseInt(colorIntensity.value),
                        parseInt(textContrast.value),
                        removeLogoCheckbox ? removeLogoCheckbox.checked : false,
                        pageBoxes[pageNum + 1],
                        imgData.width,
                        imgData.height
                    );
                    ctxSlideInv.putImageData(imgData, 0, 0);
                    
                    const rIdx = Math.floor(idx / cols);
                    const cIdx = idx % cols;
                    
                    const cellX = marginX + cIdx * (cellW + gapX);
                    const cellY = marginY + rIdx * (cellH + gapY);
                    
                    const pasteX = cellX + Math.floor((cellW - fitW) / 2);
                    const pasteY = cellY + Math.floor((cellH - fitH) / 2);
                    
                    ctxPageOrig.drawImage(canvasSlideOrig, pasteX, pasteY, fitW, fitH);
                    ctxPageOrig.strokeStyle = '#dcdcdc';
                    ctxPageOrig.lineWidth = 1;
                    ctxPageOrig.strokeRect(pasteX, pasteY, fitW, fitH);
                    
                    ctxPageInv.drawImage(canvasSlideInv, pasteX, pasteY, fitW, fitH);
                    ctxPageInv.strokeStyle = '#dcdcdc';
                    ctxPageInv.lineWidth = 1;
                    ctxPageInv.strokeRect(pasteX, pasteY, fitW, fitH);
                }
                
                imgBefore.src = canvasPageOrig.toDataURL('image/png');
                imgAfter.src = canvasPageInv.toDataURL('image/png');
                showPreviewCompare();
                updatePageControls();
            }
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
        
        if (isDrawMode || !isGrid) {
            if (pageBoxes[currentPage] && pageBoxes[currentPage].length > 0) {
                params.append('boxes', JSON.stringify({ [currentPage]: pageBoxes[currentPage] }));
            }
        } else {
            params.append('slides_per_page', slidesPerPage);
            params.append('slide_scale', slideScaleValPct);
            params.append('page_range', pageRangeInput.value.trim());
            params.append('boxes', JSON.stringify(pageBoxes));
        }

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
    if (drawControlsBar) drawControlsBar.classList.add('hidden');
    conversionProgressBox.classList.add('hidden');
    conversionCompletedBox.classList.add('hidden');
}

function showPreviewCompare() {
    previewLoading.classList.add('hidden');
    compareContainer.classList.remove('hidden');
    previewNav.classList.remove('hidden');
    if (drawControlsBar) drawControlsBar.classList.remove('hidden');
    
    // Sync slider layouts
    setTimeout(syncSliderDimensions, 50);
}

function showError(msg) {
    alert(msg);
}

function invertPixelsClientSide(data, mode, threshold, intensity, contrast, removeLogo, boxes, w, h) {
    w = Math.round(w);
    h = Math.round(h);
    let hasBoxes = boxes && boxes.length > 0;
    
    for (let i = 0; i < data.length; i += 4) {
        let pixelIndex = i / 4;
        let px = pixelIndex % w;
        let py = Math.floor(pixelIndex / w);
        let pxPct = px / w * 100.0;
        let pyPct = py / h * 100.0;
        
        if (removeLogo && pxPct >= 0 && pxPct <= 12 && pyPct >= 0 && pyPct <= 12) {
            data[i] = 255;
            data[i+1] = 255;
            data[i+2] = 255;
            continue;
        }
        
        let insideBox = false;
        if (hasBoxes) {
            for (let b = 0; b < boxes.length; b++) {
                let box = boxes[b];
                if (pxPct >= box[0] && pxPct <= box[2] && pyPct >= box[1] && pyPct <= box[3]) {
                    insideBox = true;
                    break;
                }
            }
        }
        
        if (insideBox) {
            continue; // Skip processing to preserve original diagram color
        }

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

        // 5. Apply Contrast / Boldness enhancement (Gamma correction)
        if (contrast && contrast > 100) {
            let gamma = contrast / 100.0;
            let final_r = data[i];
            let final_g = data[i+1];
            let final_b = data[i+2];
            
            data[i] = Math.max(0, Math.min(255, Math.pow(final_r / 255.0, gamma) * 255.0));
            data[i+1] = Math.max(0, Math.min(255, Math.pow(final_g / 255.0, gamma) * 255.0));
            data[i+2] = Math.max(0, Math.min(255, Math.pow(final_b / 255.0, gamma) * 255.0));
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
                const processedSlides = [];
                const slidesPerPage = parseInt(slidesSelect.value);
                const slideScaleValPct = parseInt(slideScale.value);
                const dpi = parseInt(dpiSelect.value);
                
                for (let idx = 0; idx < pages.length; idx++) {
                    const pageNum = pages[idx];
                    
                    // Update UI
                    const pct = Math.round((idx / pages.length) * 80);
                    progressPercentageDisplay.textContent = `${pct}%`;
                    progressBarFill.style.width = `${pct}%`;
                    progressStatusTitle.textContent = `Processing page ${pageNum + 1}...`;
                    progressStatusSub.textContent = `Slide ${idx + 1} of ${pages.length}`;
                    
                    addLogEntry(`Rendering page ${pageNum + 1}...`, 'info');
                    
                    const pageObj = await clientPdfDoc.getPage(pageNum + 1);
                    const scaleDPI = dpi / 72.0;
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
                        parseInt(colorIntensity.value),
                        parseInt(textContrast.value),
                        removeLogoCheckbox ? removeLogoCheckbox.checked : false,
                        pageBoxes[pageNum + 1],
                        imgData.width,
                        imgData.height
                    );
                    ctx.putImageData(imgData, 0, 0);
                    
                    // Compress to JPEG
                    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    processedSlides.push({
                        dataUrl: imgDataUrl,
                        w: canvas.width,
                        h: canvas.height
                    });
                    
                    addLogEntry(`Processed slide ${pageNum + 1} successfully.`, 'info');
                }
                
                progressPercentageDisplay.textContent = '85%';
                progressBarFill.style.width = '85%';
                progressStatusTitle.textContent = 'Compiling PDF pages...';
                progressStatusSub.textContent = 'Arranging slides in grids';
                addLogEntry(`Compiling ${processedSlides.length} slides (${slidesPerPage} slides/page)...`, 'info');
                
                if (slidesPerPage === 1 && slideScaleValPct === 100) {
                    const firstSlide = processedSlides[0];
                    pdfDocOut = new jsPDF({
                        orientation: firstSlide.w > firstSlide.h ? 'l' : 'p',
                        unit: 'px',
                        format: [firstSlide.w, firstSlide.h],
                        compress: true
                    });
                    
                    processedSlides.forEach((slide, idx) => {
                        if (idx > 0) {
                            pdfDocOut.addPage([slide.w, slide.h], slide.w > slide.h ? 'l' : 'p');
                        }
                        pdfDocOut.addImage(slide.dataUrl, 'JPEG', 0, 0, slide.w, slide.h);
                    });
                } else {
                    // Grid layouts on A4 paper (1, 2, 3, 4, 6, 8, 10 slides per page)
                    const layouts = {
                        1: { cols: 1, rows: 1, orient: 'l' },
                        2: { cols: 1, rows: 2, orient: 'p' },
                        3: { cols: 1, rows: 3, orient: 'p' },
                        4: { cols: 2, rows: 2, orient: 'p' },
                        6: { cols: 2, rows: 3, orient: 'p' },
                        8: { cols: 2, rows: 4, orient: 'p' },
                        10: { cols: 2, rows: 5, orient: 'p' }
                    };
                    const layout = layouts[slidesPerPage] || { cols: 1, rows: 1, orient: 'l' };
                    const cols = layout.cols;
                    const rows = layout.rows;
                    const orient = layout.orient;
                    
                    const a4W = Math.round(8.27 * dpi);
                    const a4H = Math.round(11.69 * dpi);
                    const pageW = orient === 'l' ? a4H : a4W;
                    const pageH = orient === 'l' ? a4W : a4H;
                    
                    pdfDocOut = new jsPDF({
                        orientation: orient,
                        unit: 'px',
                        format: [pageW, pageH],
                        compress: true
                    });
                    
                    const marginX = Math.round(0.04 * pageW);
                    const marginY = Math.round(0.04 * pageH);
                    const gapX = Math.round(0.02 * pageW);
                    const gapY = Math.round(0.02 * pageH);
                    
                    const usableW = pageW - 2 * marginX - (cols - 1) * gapX;
                    const usableH = pageH - 2 * marginY - (rows - 1) * gapY;
                    
                    const cellW = Math.floor(usableW / cols);
                    const cellH = Math.floor(usableH / rows);
                    
                    const firstSlide = processedSlides[0];
                    const origAspect = firstSlide.w / firstSlide.h;
                    const targetAspect = cellW / cellH;
                    
                    let fitW, fitH;
                    if (origAspect > targetAspect) {
                        fitW = cellW;
                        fitH = Math.floor(cellW / origAspect);
                    } else {
                        fitH = cellH;
                        fitW = Math.floor(cellH * origAspect);
                    }
                    
                    // Apply slide size scale factor
                    const scaleFactor = slideScaleValPct / 100.0;
                    fitW = Math.floor(fitW * scaleFactor);
                    fitH = Math.floor(fitH * scaleFactor);
                    
                    const chunkSize = cols * rows;
                    let pageIndex = 0;
                    
                    for (let i = 0; i < processedSlides.length; i += chunkSize) {
                        const chunk = processedSlides.slice(i, i + chunkSize);
                        
                        if (pageIndex > 0) {
                            pdfDocOut.addPage([pageW, pageH], orient);
                        }
                        
                        chunk.forEach((slide, idx) => {
                            const rIdx = Math.floor(idx / cols);
                            const cIdx = idx % cols;
                            
                            const cellX = marginX + cIdx * (cellW + gapX);
                            const cellY = marginY + rIdx * (cellH + gapY);
                            
                            const pasteX = cellX + Math.floor((cellW - fitW) / 2);
                            const pasteY = cellY + Math.floor((cellH - fitH) / 2);
                            
                            pdfDocOut.addImage(slide.dataUrl, 'JPEG', pasteX, pasteY, fitW, fitH);
                            
                            // Draw thin guide border
                            pdfDocOut.setDrawColor(220, 220, 220);
                            pdfDocOut.setLineWidth(1);
                            pdfDocOut.rect(pasteX, pasteY, fitW, fitH);
                        });
                        
                        pageIndex++;
                    }
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
            output_name: outputNameInput.value.trim(),
            slides_per_page: parseInt(slidesSelect.value),
            slide_scale: parseInt(slideScale.value),
            boxes: pageBoxes
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

// 7. Drawing Canvas Helper Functions
function setupDrawingEvents() {
    if (!boxesContainer || !drawModeBtn || !clearBoxesBtn) return;
    
    drawModeBtn.addEventListener('click', () => {
        isDrawMode = !isDrawMode;
        
        const slidesPerPage = parseInt(slidesSelect.value);
        const slideScaleValPct = parseInt(slideScale.value);
        const isGrid = (slidesPerPage > 1 || slideScaleValPct < 100);
        
        if (isDrawMode) {
            drawModeBtn.classList.add('active');
            drawModeBtn.style.background = 'var(--primary)';
            drawModeBtn.textContent = '✔️ Done Drawing';
            boxesContainer.classList.remove('hidden');
            boxesContainer.style.pointerEvents = 'auto';
            if (drawHintBadge) drawHintBadge.classList.remove('hidden');
            
            if (isGrid) {
                const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
                if (pages.length > 0) {
                    const sheetIndex = currentPage - 1;
                    const idx = Math.min(pages.length - 1, sheetIndex * slidesPerPage);
                    currentPage = pages[idx] + 1;
                }
            }
        } else {
            drawModeBtn.classList.remove('active');
            drawModeBtn.style.background = '';
            drawModeBtn.textContent = '🎨 Draw Box';
            boxesContainer.classList.add('hidden');
            boxesContainer.style.pointerEvents = 'none';
            if (drawHintBadge) drawHintBadge.classList.add('hidden');
            
            if (isGrid) {
                const pages = parsePageRangeClient(pageRangeInput.value, totalPages);
                if (pages.length > 0) {
                    const slideIndex = pages.indexOf(currentPage - 1);
                    if (slideIndex !== -1) {
                        currentPage = Math.floor(slideIndex / slidesPerPage) + 1;
                    } else {
                        currentPage = 1;
                    }
                }
            }
        }
        
        drawStoredBoxes();
        loadPreview();
    });
    
    clearBoxesBtn.addEventListener('click', () => {
        pageBoxes[currentPage] = [];
        drawStoredBoxes();
        loadPreview();
    });
    
    boxesContainer.addEventListener('mousedown', (e) => {
        if (!isDrawMode) return;
        
        // Skip default behaviors for delete buttons
        if (e.target.classList.contains('box-delete-btn')) {
            return;
        }
        
        const rect = boxesContainer.getBoundingClientRect();
        const curX = (e.clientX - rect.left) / rect.width * 100.0;
        const curY = (e.clientY - rect.top) / rect.height * 100.0;
        
        // 1. Check if clicked a resize handle of the selected box
        if (e.target.classList.contains('box-resize-handle')) {
            activeAction = 'resizing';
            activeBoxIndex = parseInt(e.target.dataset.index);
            const box = pageBoxes[currentPage][activeBoxIndex];
            boxOriginals = { x1: box[0], y1: box[1], x2: box[2], y2: box[3] };
            dragStart = { x: curX, y: curY };
            e.stopPropagation();
            e.preventDefault();
            return;
        }
        
        // 2. Check if clicked inside a diagram box
        if (e.target.classList.contains('diagram-box')) {
            const idx = parseInt(e.target.dataset.index);
            
            if (idx === selectedBoxIndex) {
                // Already selected, start moving
                activeAction = 'moving';
                activeBoxIndex = idx;
                const box = pageBoxes[currentPage][activeBoxIndex];
                boxOriginals = { x1: box[0], y1: box[1], x2: box[2], y2: box[3] };
                dragStart = { x: curX, y: curY };
                e.stopPropagation();
                e.preventDefault();
            } else {
                // Select box and redraw
                selectedBoxIndex = idx;
                drawStoredBoxes();
                e.stopPropagation();
                e.preventDefault();
            }
            return;
        }
        
        // 3. Otherwise, click on background: deselect active box and start drawing a new one
        selectedBoxIndex = null;
        drawStoredBoxes();
        
        activeAction = 'drawing';
        dragStart = { x: curX, y: curY };
        
        // Create temporary drawing div
        tempBoxEl = document.createElement('div');
        tempBoxEl.className = 'diagram-box temp';
        tempBoxEl.style.left = curX + '%';
        tempBoxEl.style.top = curY + '%';
        tempBoxEl.style.width = '0%';
        tempBoxEl.style.height = '0%';
        boxesContainer.appendChild(tempBoxEl);
        e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!isDrawMode || !activeAction) return;
        
        const rect = boxesContainer.getBoundingClientRect();
        const curX = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100.0));
        const curY = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100.0));
        
        if (activeAction === 'drawing' && tempBoxEl) {
            const x1 = Math.min(dragStart.x, curX);
            const y1 = Math.min(dragStart.y, curY);
            const x2 = Math.max(dragStart.x, curX);
            const y2 = Math.max(dragStart.y, curY);
            
            tempBoxEl.style.left = x1 + '%';
            tempBoxEl.style.top = y1 + '%';
            tempBoxEl.style.width = (x2 - x1) + '%';
            tempBoxEl.style.height = (y2 - y1) + '%';
        }
        else if (activeAction === 'moving' && activeBoxIndex >= 0) {
            const dx = curX - dragStart.x;
            const dy = curY - dragStart.y;
            
            let x1 = boxOriginals.x1 + dx;
            let y1 = boxOriginals.y1 + dy;
            const w = boxOriginals.x2 - boxOriginals.x1;
            const h = boxOriginals.y2 - boxOriginals.y1;
            
            // Boundary clamping
            if (x1 < 0) x1 = 0;
            if (y1 < 0) y1 = 0;
            if (x1 + w > 100) x1 = 100 - w;
            if (y1 + h > 100) y1 = 100 - h;
            
            const box = pageBoxes[currentPage][activeBoxIndex];
            box[0] = x1;
            box[1] = y1;
            box[2] = x1 + w;
            box[3] = y1 + h;
            
            const el = boxesContainer.querySelector(`.diagram-box[data-index="${activeBoxIndex}"]`);
            if (el) {
                el.style.left = x1 + '%';
                el.style.top = y1 + '%';
            }
        }
        else if (activeAction === 'resizing' && activeBoxIndex >= 0) {
            const dx = curX - dragStart.x;
            const dy = curY - dragStart.y;
            
            const x2 = Math.max(boxOriginals.x1 + 1.5, Math.min(100, boxOriginals.x2 + dx));
            const y2 = Math.max(boxOriginals.y1 + 1.5, Math.min(100, boxOriginals.y2 + dy));
            
            const box = pageBoxes[currentPage][activeBoxIndex];
            box[2] = x2;
            box[3] = y2;
            
            const el = boxesContainer.querySelector(`.diagram-box[data-index="${activeBoxIndex}"]`);
            if (el) {
                el.style.width = (x2 - boxOriginals.x1) + '%';
                el.style.height = (y2 - boxOriginals.y1) + '%';
            }
        }
    });
    
    window.addEventListener('mouseup', () => {
        if (!isDrawMode || !activeAction) return;
        
        if (activeAction === 'drawing' && tempBoxEl) {
            const w = parseFloat(tempBoxEl.style.width);
            const h = parseFloat(tempBoxEl.style.height);
            const x1 = parseFloat(tempBoxEl.style.left);
            const y1 = parseFloat(tempBoxEl.style.top);
            
            // Only add if it meets minimum size of 1.5%
            if (w > 1.5 && h > 1.5) {
                if (!pageBoxes[currentPage]) pageBoxes[currentPage] = [];
                pageBoxes[currentPage].push([x1, y1, x1 + w, y1 + h]);
                selectedBoxIndex = pageBoxes[currentPage].length - 1;
            }
            tempBoxEl.remove();
            tempBoxEl = null;
        }
        
        activeAction = null;
        activeBoxIndex = -1;
        drawStoredBoxes();
        loadPreview();
    });
}

function drawStoredBoxes() {
    if (!boxesContainer || !clearBoxesBtn) return;
    
    // Clear previous elements
    boxesContainer.innerHTML = '';
    
    const boxes = pageBoxes[currentPage] || [];
    
    boxes.forEach((box, idx) => {
        const x1 = box[0];
        const y1 = box[1];
        const w = box[2] - box[0];
        const h = box[3] - box[1];
        
        const boxEl = document.createElement('div');
        boxEl.className = 'diagram-box';
        boxEl.dataset.index = idx;
        boxEl.style.left = x1 + '%';
        boxEl.style.top = y1 + '%';
        boxEl.style.width = w + '%';
        boxEl.style.height = h + '%';
        
        if (idx === selectedBoxIndex) {
            boxEl.classList.add('selected');
            
            // Single delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'box-delete-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = 'Delete this diagram box';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pageBoxes[currentPage].splice(idx, 1);
                selectedBoxIndex = null;
                drawStoredBoxes();
                loadPreview();
            });
            boxEl.appendChild(deleteBtn);
            
            // Resize handle dot
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'box-resize-handle';
            resizeHandle.dataset.index = idx;
            boxEl.appendChild(resizeHandle);
        }
        
        boxesContainer.appendChild(boxEl);
    });
    
    clearBoxesBtn.disabled = (boxes.length === 0);
}
