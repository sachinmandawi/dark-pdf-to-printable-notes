import os
import sys
import time
import io
import base64
import shutil
import threading
import uuid
from typing import List, Optional
import numpy as np
import fitz  # PyMuPDF
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Dark PDF Notes Converter")

# Directory Setup
BASE_DIR = r"d:\Notes"
CACHE_DIR = os.path.join(BASE_DIR, "cache")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

for d in [CACHE_DIR, OUTPUT_DIR]:
    os.makedirs(d, exist_ok=True)

# Global Task Registry
tasks = {}
tasks_lock = threading.Lock()

class ConvertRequest(BaseModel):
    filepath: str
    mode: str
    dpi: int
    threshold: int
    intensity: int
    page_range: str
    output_name: str
    slides_per_page: Optional[int] = 1
    slide_scale: Optional[int] = 95
    boxes: Optional[dict] = None

def add_task_log(task_id: str, text: str, level: str = "info"):
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id]["logs"].append({"text": text, "level": level})

def update_task_progress(task_id: str, progress: int, title: str, message: str):
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id]["progress"] = progress
            tasks[task_id]["title"] = title
            tasks[task_id]["message"] = message

def parse_page_range(range_str: str, total_pages: int) -> List[int]:
    if not range_str or range_str.strip().lower() == "all":
        return list(range(total_pages))
    
    pages = set()
    for part in range_str.split(','):
        part = part.strip()
        if '-' in part:
            try:
                start, end = part.split('-')
                start_val = int(start.strip())
                end_val = int(end.strip())
                for p in range(start_val, end_val + 1):
                    if 1 <= p <= total_pages:
                        pages.add(p - 1)
            except ValueError:
                pass
        else:
            try:
                p = int(part)
                if 1 <= p <= total_pages:
                    pages.add(p - 1)
            except ValueError:
                pass
    return sorted(list(pages))

# Process Image Array
def invert_pixels(arr_np: np.ndarray, mode: str, threshold: int, intensity: int, boxes: Optional[List[List[float]]] = None) -> Image.Image:
    r, g, b = arr_np[:,:,0], arr_np[:,:,1], arr_np[:,:,2]
    max_c = np.maximum(np.maximum(r, g), b)
    
    if mode == "grayscale":
        # Grayscale calculation
        y = 0.299 * r + 0.587 * g + 0.114 * b
        inverted_y = 255.0 - y
        
        # Clean background thresholding
        inverted_y = np.where(inverted_y > threshold, 255.0, inverted_y)
        
        # Scale contrast/intensity
        scale = intensity / 110.0
        inverted_y = np.clip(inverted_y * scale, 0.0, 255.0)
        
        target_arr = np.repeat(inverted_y[:, :, np.newaxis], 3, axis=2)
        
    elif mode == "simple":
        # Basic Negative Inversion
        target_arr = 255.0 - arr_np
        
    else: # "smart" mode
        min_c = np.minimum(np.minimum(r, g), b)
        chroma = max_c - min_c
        
        # 1. Color mask: 1.0 for colored, 0.0 for neutral
        color_mask = np.clip((chroma - 10.0) / 30.0, 0.0, 1.0)
        color_mask = color_mask[:, :, np.newaxis]
        
        # 2. Inverted Neutral (white text -> black, black background -> white)
        neutral_inv = 255.0 - arr_np
        max_neutral = np.maximum(np.maximum(neutral_inv[:,:,0], neutral_inv[:,:,1]), neutral_inv[:,:,2])
        # Clean background thresholding
        for i in range(3):
            neutral_inv[:,:,i] = np.where(max_neutral > threshold, 255.0, neutral_inv[:,:,i])
            
        # 3. Color preservation:
        # Scale original color based on intensity slider (default 110 means scale=1.0, i.e., original color)
        scale = intensity / 110.0
        scale = np.minimum(scale, 1.0) # don't brighten beyond original colors
        
        scaled_arr = arr_np * scale
        scaled_max_c = max_c * scale
        
        # Background compensation (adds white to background pixels)
        bg_comp = 255.0 - scaled_max_c
        color_preserved = scaled_arr + bg_comp[:, :, np.newaxis]
        color_preserved = np.clip(color_preserved, 0.0, 255.0)
        
        # 4. Combine
        target_arr = (1.0 - color_mask) * neutral_inv + color_mask * color_preserved
        
    # Apply Bounding Box Mask if provided (reverts pixels inside boxes back to original)
    if boxes:
        H, W, _ = arr_np.shape
        diagram_mask = np.zeros((H, W, 1), dtype=np.float32)
        for box in boxes:
            x1 = int(box[0] * W / 100.0)
            y1 = int(box[1] * H / 100.0)
            x2 = int(box[2] * W / 100.0)
            y2 = int(box[3] * H / 100.0)
            diagram_mask[y1:y2, x1:x2, 0] = 1.0
        target_arr = (1.0 - diagram_mask) * target_arr + diagram_mask * arr_np

    final_arr = np.clip(target_arr, 0.0, 255.0).astype(np.uint8)
    return Image.fromarray(final_arr)

# Background Worker
def convert_pdf_worker(
    task_id: str,
    filepath: str,
    mode: str,
    dpi: int,
    threshold: int,
    intensity: int,
    page_range: str,
    output_name: str,
    slides_per_page: int = 1,
    slide_scale: int = 95,
    boxes: Optional[dict] = None
):
    temp_files = []
    try:
        add_task_log(task_id, f"Opening PDF: {os.path.basename(filepath)}", "info")
        doc = fitz.open(filepath)
        total_pages = len(doc)
        
        pages_to_process = parse_page_range(page_range, total_pages)
        if not pages_to_process:
            raise Exception("No pages matched the specified page range.")
            
        add_task_log(task_id, f"Processing {len(pages_to_process)} pages out of {total_pages} total pages.", "info")
        
        # Define output path
        input_dir = os.path.dirname(filepath)
        if os.path.abspath(input_dir).lower() == os.path.abspath(CACHE_DIR).lower():
            out_pdf_path = os.path.join(OUTPUT_DIR, output_name)
        else:
            out_pdf_path = os.path.join(input_dir, output_name)
            
        # Store in task details
        with tasks_lock:
            tasks[task_id]["output_path"] = out_pdf_path
            
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        
        for idx, page_num in enumerate(pages_to_process):
            # Check cancellation flag
            with tasks_lock:
                if tasks[task_id]["cancelled"]:
                    add_task_log(task_id, "Conversion cancelled by user.", "warning")
                    doc.close()
                    # clean up temp files
                    for tf in temp_files:
                        try: os.remove(tf)
                        except: pass
                    tasks[task_id]["status"] = "failed"
                    tasks[task_id]["error"] = "Cancelled by user"
                    return
            
            update_task_progress(
                task_id, 
                int((idx / len(pages_to_process)) * 90), 
                f"Processing page {page_num + 1}...", 
                f"Page {idx + 1} of {len(pages_to_process)}"
            )
            
            page = doc.load_page(page_num)
            pix = page.get_pixmap(matrix=mat)
            
            # Convert to numpy
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.height, pix.width, 3)).astype(np.float32)
            
            # Extract boxes for this page
            page_boxes = boxes.get(str(page_num + 1)) if boxes else None
            
            # Run Inversion
            img = invert_pixels(arr, mode, threshold, intensity, page_boxes)
            
            # Save to temporary image on disk (saves RAM)
            temp_img_path = os.path.join(CACHE_DIR, f"task_{task_id}_p{page_num}.png")
            img.save(temp_img_path)
            temp_files.append(temp_img_path)
            
            add_task_log(task_id, f"Processed page {page_num + 1}", "info")
            
        # Compile to PDF
        update_task_progress(task_id, 92, "Compiling PDF document...", "Compressing slides")
        add_task_log(task_id, f"Compiling inverted pages into final PDF ({slides_per_page} slides/page)...", "info")
        
        if slides_per_page == 1 and slide_scale == 100:
            # 1 Slide Per Page (Standard compiler)
            images = [Image.open(tf) for tf in temp_files]
            if images:
                images[0].save(
                    out_pdf_path,
                    "PDF",
                    resolution=float(dpi),
                    save_all=True,
                    append_images=images[1:]
                )
                for img in images:
                    img.close()
        else:
            # N-up grid layouts on A4 paper: (cols, rows, orientation)
            layouts = {
                1: (1, 1, 'l'),
                2: (1, 2, 'p'),
                3: (1, 3, 'p'),
                4: (2, 2, 'p'),
                6: (2, 3, 'p'),
                8: (2, 4, 'p'),
                10: (2, 5, 'p')
            }
            cols, rows, orient = layouts.get(slides_per_page, (1, 1, 'l'))
            
            # A4 size in pixels: 8.27 x 11.69 inches. Scale by DPI.
            a4_w = int(8.27 * dpi)
            a4_h = int(11.69 * dpi)
            page_w = a4_h if orient == 'l' else a4_w
            page_h = a4_w if orient == 'l' else a4_h
            
            # Margins and gaps
            margin_x = int(0.04 * page_w)
            margin_y = int(0.04 * page_h)
            gap_x = int(0.02 * page_w)
            gap_y = int(0.02 * page_h)
            
            usable_w = page_w - 2 * margin_x - (cols - 1) * gap_x
            usable_h = page_h - 2 * margin_y - (rows - 1) * gap_y
            
            cell_w = usable_w // cols
            cell_h = usable_h // rows
            
            # Read first image to determine aspect ratio
            first_img = Image.open(temp_files[0])
            orig_w, orig_h = first_img.size
            first_img.close()
            
            orig_aspect = orig_w / orig_h
            target_aspect = cell_w / cell_h
            
            if orig_aspect > target_aspect:
                fit_w = cell_w
                fit_h = int(cell_w / orig_aspect)
            else:
                fit_h = cell_h
                fit_w = int(cell_h * orig_aspect)
                
            # Apply slide size scale factor
            scale_factor = slide_scale / 100.0
            fit_w = int(fit_w * scale_factor)
            fit_h = int(fit_h * scale_factor)
            
            grid_pages = []
            chunk_size = cols * rows
            
            for i in range(0, len(temp_files), chunk_size):
                chunk = temp_files[i : i + chunk_size]
                
                # Create blank A4 page
                page_img = Image.new("RGB", (page_w, page_h), (255, 255, 255))
                from PIL import ImageDraw
                draw = ImageDraw.Draw(page_img)
                
                for idx, tf in enumerate(chunk):
                    img = Image.open(tf)
                    img_resized = img.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
                    
                    r_idx = idx // cols
                    c_idx = idx % cols
                    
                    cell_x = margin_x + c_idx * (cell_w + gap_x)
                    cell_y = margin_y + r_idx * (cell_h + gap_y)
                    
                    # Center inside cell
                    paste_x = cell_x + (cell_w - fit_w) // 2
                    paste_y = cell_y + (cell_h - fit_h) // 2
                    
                    page_img.paste(img_resized, (paste_x, paste_y))
                    img.close()
                    
                    # Draw border Guide
                    draw.rectangle(
                        [paste_x, paste_y, paste_x + fit_w, paste_y + fit_h], 
                        outline=(220, 220, 220), 
                        width=1
                    )
                    
                grid_pages.append(page_img)
                
            if grid_pages:
                grid_pages[0].save(
                    out_pdf_path,
                    "PDF",
                    resolution=float(dpi),
                    save_all=True,
                    append_images=grid_pages[1:]
                )
                for p in grid_pages:
                    p.close()
                
        # Clean up temp files
        for tf in temp_files:
            try: os.remove(tf)
            except: pass
            
        doc.close()
        
        update_task_progress(task_id, 100, "Done!", "Conversion successful")
        add_task_log(task_id, f"PDF saved successfully: {out_pdf_path}", "success")
        
        with tasks_lock:
            tasks[task_id]["status"] = "success"
            
    except Exception as e:
        # Clean up temp files
        for tf in temp_files:
            try: os.remove(tf)
            except: pass
        add_task_log(task_id, f"Error during conversion: {str(e)}", "error")
        with tasks_lock:
            tasks[task_id]["status"] = "failed"
            tasks[task_id]["error"] = str(e)


# --- REST API Endpoints ---

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    # Save uploaded file
    file_id = str(uuid.uuid4())
    filename = file.filename
    temp_path = os.path.join(CACHE_DIR, f"{file_id}_{filename}")
    
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    try:
        doc = fitz.open(temp_path)
        total_pages = len(doc)
        doc.close()
    except Exception as e:
        os.remove(temp_path)
        raise HTTPException(status_code=400, detail="Invalid PDF file.")
        
    return {
        "filepath": temp_path,
        "filename": filename,
        "total_pages": total_pages
    }

@app.get("/api/metadata")
async def get_metadata(path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found on system.")
        
    try:
        doc = fitz.open(path)
        total_pages = len(doc)
        doc.close()
        size_mb = os.path.getsize(path) / (1024 * 1024)
        return {
            "total_pages": total_pages,
            "size_mb": size_mb
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading PDF: {str(e)}")

@app.get("/api/preview")
async def get_preview(
    filepath: str,
    page: int,
    mode: str,
    dpi: int,
    threshold: int,
    intensity: int,
    boxes: Optional[str] = None
):
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found.")
        
    try:
        doc = fitz.open(filepath)
        if page < 1 or page > len(doc):
            raise HTTPException(status_code=400, detail="Invalid page index.")
            
        page_obj = doc.load_page(page - 1)
        
        # Render original at standard 100 DPI for preview performance
        zoom_orig = 1.2
        pix_orig = page_obj.get_pixmap(matrix=fitz.Matrix(zoom_orig, zoom_orig))
        img_orig = Image.frombytes("RGB", [pix_orig.width, pix_orig.height], pix_orig.samples)
        
        # Render target DPI for the inverted version to preview actual resolution
        zoom_target = dpi / 72.0
        pix_target = page_obj.get_pixmap(matrix=fitz.Matrix(zoom_target, zoom_target))
        arr = np.frombuffer(pix_target.samples, dtype=np.uint8).reshape((pix_target.height, pix_target.width, 3)).astype(np.float32)
        
        # Parse boxes JSON string if provided
        parsed_boxes = None
        if boxes:
            try:
                import json
                parsed_boxes = json.loads(boxes)
            except Exception as ex:
                print(f"Error parsing preview boxes: {ex}")
        
        # Process preview
        img_inv = invert_pixels(arr, mode, threshold, intensity, parsed_boxes)
        
        # Encode original as PNG base64
        buf_orig = io.BytesIO()
        img_orig.save(buf_orig, format="PNG")
        base64_orig = base64.b64encode(buf_orig.getvalue()).decode("utf-8")
        
        # Encode inverted as PNG base64
        buf_inv = io.BytesIO()
        img_inv.save(buf_inv, format="PNG")
        base64_inv = base64.b64encode(buf_inv.getvalue()).decode("utf-8")
        
        doc.close()
        
        return {
            "before": base64_orig,
            "after": base64_inv
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/convert")
async def convert_pdf(req: ConvertRequest, background_tasks: BackgroundTasks):
    if not os.path.exists(req.filepath):
        raise HTTPException(status_code=404, detail="Input file not found.")
        
    task_id = str(uuid.uuid4())
    
    with tasks_lock:
        tasks[task_id] = {
            "progress": 0,
            "status": "running",
            "title": "Starting task...",
            "message": "Initializing worker",
            "logs": [],
            "cancelled": False,
            "output_path": "",
            "error": None
        }
        
    # Start task in background thread
    t = threading.Thread(
        target=convert_pdf_worker,
        args=(
            task_id,
            req.filepath,
            req.mode,
            req.dpi,
            req.threshold,
            req.intensity,
            req.page_range,
            req.output_name,
            req.slides_per_page,
            req.slide_scale,
            req.boxes
        )
    )
    t.daemon = True
    t.start()
    
    return {"task_id": task_id}

@app.get("/api/status/{task_id}")
async def get_task_status(task_id: str):
    with tasks_lock:
        if task_id not in tasks:
            raise HTTPException(status_code=404, detail="Task not found")
        
        task = tasks[task_id]
        
        # Fetch and clear logs so we don't return duplicates
        logs_to_return = task["logs"]
        task["logs"] = []
        
        return {
            "progress": task["progress"],
            "status": task["status"],
            "title": task["title"],
            "message": task["message"],
            "logs": logs_to_return,
            "error": task["error"]
        }

@app.post("/api/cancel/{task_id}")
async def cancel_task(task_id: str):
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id]["cancelled"] = True
            return {"status": "cancelled"}
        else:
            raise HTTPException(status_code=404, detail="Task not found")

@app.get("/api/open-file")
async def open_file(output_name: str):
    # Search for output file in output folder or cache
    out_path = os.path.join(OUTPUT_DIR, output_name)
    if not os.path.exists(out_path):
        # Check cache if they uploaded
        out_path = os.path.join(CACHE_DIR, output_name)
        
    if not os.path.exists(out_path):
        # Check if we have output_path saved in task history
        found = False
        with tasks_lock:
            for t_id, task in tasks.items():
                if task.get("output_path") and os.path.basename(task["output_path"]) == output_name:
                    out_path = task["output_path"]
                    found = True
                    break
        if not found:
            raise HTTPException(status_code=404, detail="File not found")
            
    try:
        # Open file on Windows
        os.startfile(out_path)
        return {"status": "opened"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/open-folder")
async def open_folder():
    try:
        os.startfile(OUTPUT_DIR)
        return {"status": "opened"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount Static Files at Root
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Run server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
