import os
import re
import fitz
import json
import io
import time
from PIL import Image
import google.generativeai as genai
from dotenv import load_dotenv

def extract_from_pdf():
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY not found in .env")
        return
    
    genai.configure(api_key=api_key)
    # Available models from list_models(): gemini-2.0-flash, gemini-flash-latest (which is 1.5-flash)
    model_name = 'gemini-2.0-flash'
    model = genai.GenerativeModel(model_name)
    
    pdf_path = r"C:\Users\dogul\OneDrive\Masaüstü\3000 Most Common English Words.pdf"
    if not os.path.exists(pdf_path):
        print(f"PDF not found at {pdf_path}")
        return

    doc = fitz.open(pdf_path)
    all_extracted_words = set()

    print(f"Processing {len(doc)} pages with {model_name}...")
    
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2)) # Higher resolution
        img_data = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_data))
        
        prompt = "Extract all individual English words from this list. Provide them as a raw list, one word per line. Ignore headers, numbers, and definitions if any exist. Just the words."
        
        try:
            response = model.generate_content([prompt, img])
            text = response.text
            # Normalize and filter words
            words = re.findall(r"\b[a-z][a-z'-]+\b", text.lower()) # Filter out single letters and non-words
            all_extracted_words.update(words)
            print(f"Page {page_num + 1} processed. Total unique words so far: {len(all_extracted_words)}")
            time.sleep(1) # Basic rate limiting
        except Exception as e:
            print(f"Error on page {page_num + 1}: {e}")

    # Deduplicate and sort
    sorted_words = sorted(list(all_extracted_words))
    
    # Save extracted words
    os.makedirs("scripts", exist_ok=True)
    with open("scripts/pdf_words_3000.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(sorted_words))
    
    # Compare with words.json
    try:
        with open("data/words.json", "r", encoding="utf-8") as f:
            existing_data = json.load(f)
            existing_words = set(k.lower() for k in existing_data.keys())
    except Exception as e:
        print(f"Error reading data/words.json: {e}")
        existing_words = set()

    missing_words = [w for w in sorted_words if w not in existing_words]
    
    # Save missing words
    with open("scripts/pdf_missing_words.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(missing_words))
        
    print(f"\nExtracted words: {len(sorted_words)}")
    print(f"Existing words in data/words.json: {len(existing_words)}")
    print(f"Missing words: {len(missing_words)}")
    print(f"First 50 missing: {', '.join(missing_words[:50])}")

if __name__ == '__main__':
    extract_from_pdf()
