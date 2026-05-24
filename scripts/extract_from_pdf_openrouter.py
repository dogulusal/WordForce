import os
import re
import json
import base64
import time
import fitz
import requests

def get_keys():
    # Read from .env manually to avoid load_dotenv issues with multiline or formatting
    keys = []
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if line.startswith("OPENROUTER_API_KEYS="):
                    val = line.split("=")[1].strip()
                    keys.extend([k.strip() for k in val.split(",") if k.strip()])
                elif line.startswith("OPENROUTER_API_KEY="):
                    val = line.split("=")[1].strip()
                    if val not in keys:
                        keys.append(val)
    return keys

def call_openrouter_vision(base64_image, api_key):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/OpenRouter/python-sdk", # Optional but recommended
    }
    payload = {
        "model": "openai/gpt-4o-mini",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "List the English words on this page. One per line. No extra text."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}
                ]
            }
        ]
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        return response
    except Exception as e:
        print(f"Request exception: {e}")
        return None

def main():
    pdf_path = r"C:\Users\dogul\OneDrive\Masaüstü\3000 Most Common English Words.pdf"
    keys = get_keys()
    print(f"Found {len(keys)} keys.")
    if not keys: return

    doc = fitz.open(pdf_path)
    all_extracted_words = set()
    key_index = 0
    
    for i in range(len(doc)):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
        img_bytes = pix.tobytes("png")
        b64_img = base64.b64encode(img_bytes).decode("utf-8")
        
        success = False
        for attempt in range(3):
            api_key = keys[key_index % len(keys)]
            resp = call_openrouter_vision(b64_img, api_key)
            if resp and resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                words = re.findall(r"[a-z][a-z'-]*", content.lower())
                added = 0
                for w in words:
                    if len(w) > 1 or w in ['a', 'i']:
                        all_extracted_words.add(w)
                        added += 1
                print(f"Page {i+1} success: {added} words.")
                success = True
                break
            else:
                code = resp.status_code if resp else "None"
                text = resp.text[:100] if resp else "timeout"
                print(f"Page {i+1} trial {attempt+1} failed ({code}): {text}")
                key_index += 1
                time.sleep(2)
        if not success: print(f"Page {i+1} totally failed.")

    doc.close()
    
    sorted_words = sorted(list(all_extracted_words))
    with open("scripts/pdf_words_3000.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(sorted_words))
    
    try:
        with open("data/words.json", "r", encoding="utf-8") as f:
            exist = set(k.lower() for k in json.load(f).keys())
    except: exist = set()

    missing = [w for w in sorted_words if w.lower() not in exist]
    with open("scripts/pdf_missing_words.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(missing))
    
    print(f"\nExtracted: {len(sorted_words)}, Missing: {len(missing)}")
    if missing: print(f"Sample missing: {', '.join(missing[:50])}")

if __name__ == "__main__":
    main()
