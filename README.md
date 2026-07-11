# 🎨 Dark PDF to Printable Notes Converter

An interactive local web application designed to convert dark-themed PDF lecture notes (such as Physics Wallah slide notes) into ink-saving, printable PDFs with clean white backgrounds. It preserves the color identity of handwritten annotations (yellow, green, pink, cyan, etc.) while making them dark enough to print legibly on white paper.

## Features

- **Interactive Before/After Slider**: View live slide comparison of page rendering in real-time.
- **Color-Preserving Inversion**: Intelligently darkens handwriting markers (retains hue) rather than simple negative-inverting (which turns yellow text blue and makes diagrams look like negatives).
- **Page Range Selector**: Choose to convert all pages or sections (e.g. `1-5, 8, 10-15`).
- **DPI Quality Options**: 100 DPI (fast), 150 DPI (recommended), and 300 DPI (high-resolution print).
- **Clean Background Slider**: Filters out dark slide grid lines, dust, and scan artifacts.
- **Local File Integrations**: Paste direct local file paths on your computer to process PDFs instantly without upload wait times.

## Installation & Running Locally

1. **Clone this repository**:
   ```bash
   git clone https://github.com/sachinmandawi/dark-pdf-to-printable-notes.git
   cd dark-pdf-to-printable-notes
   ```
2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
3. **Run the server**:
   ```bash
   python main.py
   ```
4. **Access the application**:
   Open **http://127.0.0.1:8000** in your web browser.

## Tech Stack
- **Backend**: FastAPI, PyMuPDF, NumPy, Pillow
- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism design system), and JavaScript
