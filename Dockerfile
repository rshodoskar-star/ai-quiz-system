#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI Quiz System V8.0 - Professional PDF Extraction Pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Features:
✅ PyMuPDF with proper layout (get_text("dict"))
✅ Block-level ordering (RTL support)
✅ PaddleOCR fallback for scanned pages
✅ Professional text normalization
✅ Arabic-optimized processing

Author: AI Quiz System Team
"""

import sys
import json
import re
import fitz  # PyMuPDF
from pathlib import Path

# Try to import optional dependencies
try:
    from paddleocr import PaddleOCR
    PADDLEOCR_AVAILABLE = True
except ImportError:
    PADDLEOCR_AVAILABLE = False
    print("⚠️ PaddleOCR not available, OCR fallback disabled", file=sys.stderr)

try:
    import ftfy
    FTFY_AVAILABLE = True
except ImportError:
    FTFY_AVAILABLE = False
    print("⚠️ ftfy not available, UTF-8 fixing disabled", file=sys.stderr)


class ArabicPDFExtractor:
    """Professional PDF text extraction with Arabic support"""
    
    def __init__(self, use_ocr=True):
        self.use_ocr = use_ocr and PADDLEOCR_AVAILABLE
        self.ocr_engine = None
        
        if self.use_ocr:
            try:
                # Initialize PaddleOCR with Arabic support
                self.ocr_engine = PaddleOCR(
                    use_angle_cls=True,
                    lang='ar',  # Arabic
                    use_gpu=False,
                    show_log=False
                )
                print("✅ PaddleOCR initialized", file=sys.stderr)
            except Exception as e:
                print(f"⚠️ PaddleOCR init failed: {e}", file=sys.stderr)
                self.use_ocr = False
    
    def extract(self, pdf_path):
        """Main extraction method"""
        try:
            doc = fitz.open(pdf_path)
            print(f"📄 Processing {len(doc)} pages...", file=sys.stderr)
            
            full_text = []
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                
                # Try PyMuPDF first with proper layout
                text = self._extract_with_layout(page)
                
                # Check if page is scanned (needs OCR)
                if self._is_scanned_page(page, text):
                    print(f"📸 Page {page_num + 1} is scanned, using OCR...", file=sys.stderr)
                    ocr_text = self._extract_with_ocr(page)
                    if ocr_text and len(ocr_text) > len(text):
                        text = ocr_text
                
                if text:
                    full_text.append(text)
            
            doc.close()
            
            # Join and normalize
            combined = "\n\n".join(full_text)
            normalized = self.normalize_text(combined)
            
            print(f"✅ Extracted {len(normalized)} characters", file=sys.stderr)
            
            return normalized
            
        except Exception as e:
            print(f"❌ Extraction error: {e}", file=sys.stderr)
            raise
    
    def _extract_with_layout(self, page):
        """Extract text with proper layout using dict mode"""
        try:
            # Get structured data with coordinates
            page_dict = page.get_text("dict")
            
            # Sort blocks by position (top to bottom, right to left for Arabic)
            blocks = sorted(
                page_dict.get("blocks", []),
                key=lambda b: (b["bbox"][1], -b["bbox"][0])  # y ascending, x descending (RTL)
            )
            
            page_lines = []
            
            for block in blocks:
                if block.get("type") == 0:  # Text block
                    if "lines" in block:
                        for line in block["lines"]:
                            line_text = ""
                            
                            # Sort spans in line (right to left for Arabic)
                            spans = sorted(
                                line.get("spans", []),
                                key=lambda s: -s["bbox"][0]  # x descending (RTL)
                            )
                            
                            for span in spans:
                                text = span.get("text", "")
                                if text:
                                    line_text += text
                            
                            if line_text.strip():
                                page_lines.append(line_text.strip())
            
            # Join lines with proper spacing
            text = self._join_lines(page_lines)
            
            return text
            
        except Exception as e:
            print(f"⚠️ Layout extraction failed: {e}", file=sys.stderr)
            # Fallback to simple text mode
            return page.get_text("text")
    
    def _is_scanned_page(self, page, text):
        """Detect if page is scanned and needs OCR"""
        # Check 1: Very little text extracted
        if len(text.strip()) < 80:
            # Check 2: Page has images
            images = page.get_images()
            if len(images) > 0:
                return True
        
        return False
    
    def _extract_with_ocr(self, page):
        """Extract text using PaddleOCR for scanned pages"""
        if not self.use_ocr or not self.ocr_engine:
            return ""
        
        try:
            # Render page to image
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x resolution
            img_data = pix.tobytes("png")
            
            # Save temporarily
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp.write(img_data)
                tmp_path = tmp.name
            
            # Run OCR
            result = self.ocr_engine.ocr(tmp_path, cls=True)
            
            # Extract text from results
            text_lines = []
            if result and result[0]:
                for line in result[0]:
                    if len(line) >= 2:
                        text = line[1][0]  # (bbox, (text, confidence))
                        if text:
                            text_lines.append(text)
            
            # Cleanup
            Path(tmp_path).unlink(missing_ok=True)
            
            return "\n".join(text_lines)
            
        except Exception as e:
            print(f"⚠️ OCR failed: {e}", file=sys.stderr)
            return ""
    
    def _join_lines(self, lines):
        """Intelligently join lines (merge broken lines)"""
        if not lines:
            return ""
        
        result = []
        current = ""
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # If current line ends with punctuation, start new paragraph
            if current and current[-1] in '.!?؟:)]}':
                result.append(current)
                current = line
            # If line starts with number/bullet, start new paragraph
            elif re.match(r'^[\d\u0660-\u0669]+[\.\)\:]', line):
                if current:
                    result.append(current)
                current = line
            # If line starts with question marker, start new paragraph
            elif line.startswith(('س', 'سؤال', 'Q')):
                if current:
                    result.append(current)
                current = line
            else:
                # Merge with current line
                if current:
                    current += " " + line
                else:
                    current = line
        
        if current:
            result.append(current)
        
        return "\n\n".join(result)
    
    def normalize_text(self, text):
        """Professional text normalization for Arabic"""
        
        # 1. Fix damaged UTF-8 (if ftfy available)
        if FTFY_AVAILABLE:
            text = ftfy.fix_text(text)
        
        # 2. Remove Arabic diacritics (tashkeel)
        text = re.sub(r'[\u064B-\u065F\u0670]', '', text)
        
        # 3. Normalize Arabic characters
        # ى -> ي
        text = text.replace('ى', 'ي')
        # أ, إ, آ -> ا
        text = re.sub(r'[أإآ]', 'ا', text)
        # ة -> ه in some contexts
        # text = text.replace('ة', 'ه')  # Commented: may not always be desired
        
        # 4. Remove strange Unicode characters common in PDFs
        weird_chars = [
            '\u200f',  # Right-to-left mark
            '\u200e',  # Left-to-right mark
            '\u200b',  # Zero-width space
            '\ufeff',  # Zero-width no-break space
            '\xa0',    # Non-breaking space
            '\u202a',  # Left-to-right embedding
            '\u202b',  # Right-to-left embedding
            '\u202c',  # Pop directional formatting
            '\u202d',  # Left-to-right override
            '\u202e',  # Right-to-left override
        ]
        for char in weird_chars:
            text = text.replace(char, '')
        
        # Remove weird bullets/symbols
        text = re.sub(r'[▪︎●■□◆◇★☆]', '', text)
        
        # 5. Fix multiple spaces
        text = re.sub(r' +', ' ', text)
        
        # 6. Fix multiple newlines (max 2)
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        # 7. Fix spaces around punctuation
        text = re.sub(r'\s+([,.!?؟:،])', r'\1', text)
        
        # 8. Remove leading/trailing whitespace from lines
        lines = [line.strip() for line in text.split('\n')]
        text = '\n'.join(lines)
        
        return text.strip()


def main():
    """Main entry point"""
    if len(sys.argv) != 2:
        print(json.dumps({
            "error": "Usage: python extract_pdf.py <pdf_file>"
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        extractor = ArabicPDFExtractor(use_ocr=True)
        text = extractor.extract(pdf_path)
        
        # Output as JSON
        result = {
            "text": text,
            "length": len(text),
            "success": True
        }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "success": False
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
