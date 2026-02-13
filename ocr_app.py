#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
写真OCRアプリケーション
写真に写っている文字を読み取って.txtファイルとして保存するMacOSアプリ
"""

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
from tkinter import ttk
import pytesseract
from PIL import Image, ImageTk, ImageFilter, ImageEnhance, ImageOps
import cv2
import numpy as np
import os
import threading

class OCRアプリ:
    def __init__(self, root):
        self.root = root
        self.root.title("写真文字読み取りアプリ")
        self.root.geometry("800x600")
        self.root.configure(bg='#f0f0f0')
        
        # 現在の画像パス
        self.current_image_path = None
        self.extracted_text = ""
        
        self.setup_ui()
        
    def setup_ui(self):
        """UIセットアップ"""
        # メインフレーム
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # タイトル
        title_label = ttk.Label(main_frame, text="📸 写真文字読み取りアプリ", 
                               font=('Helvetica', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # ボタンフレーム
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=1, column=0, columnspan=2, pady=(0, 20))
        
        # 画像選択ボタン
        self.select_button = ttk.Button(button_frame, text="📁 画像を選択", 
                                       command=self.select_image, width=20)
        self.select_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # 文字読み取りボタン
        self.ocr_button = ttk.Button(button_frame, text="🔍 文字を読み取る", 
                                    command=self.start_ocr, width=20, state='disabled')
        self.ocr_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # 手書き文字読み取りボタン
        self.handwriting_button = ttk.Button(button_frame, text="✍️ 手書き文字を読み取る", 
                                           command=self.start_handwriting_ocr, width=20, state='disabled')
        self.handwriting_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # 保存ボタン
        self.save_button = ttk.Button(button_frame, text="💾 テキストを保存", 
                                     command=self.save_text, width=20, state='disabled')
        self.save_button.pack(side=tk.LEFT)
        
        # 画像表示エリア
        image_frame = ttk.LabelFrame(main_frame, text="選択した画像", padding="10")
        image_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), padx=(0, 10))
        
        self.image_label = ttk.Label(image_frame, text="画像が選択されていません", 
                                    background='white', relief='sunken')
        self.image_label.pack(expand=True, fill='both')
        
        # テキスト表示エリア
        text_frame = ttk.LabelFrame(main_frame, text="読み取った文字", padding="10")
        text_frame.grid(row=2, column=1, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        self.text_area = scrolledtext.ScrolledText(text_frame, width=40, height=20, 
                                                  font=('Helvetica', 12))
        self.text_area.pack(expand=True, fill='both')
        
        # ステータスバー
        self.status_var = tk.StringVar()
        self.status_var.set("画像を選択してください")
        status_bar = ttk.Label(main_frame, textvariable=self.status_var, 
                              relief='sunken', anchor='w')
        status_bar.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(20, 0))
        
        # グリッドの重みを設定
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(2, weight=1)
        
    def select_image(self):
        """画像ファイルを選択"""
        file_types = [
            ('画像ファイル', '*.png *.jpg *.jpeg *.gif *.bmp *.tiff'),
            ('PNG', '*.png'),
            ('JPEG', '*.jpg *.jpeg'),
            ('すべてのファイル', '*.*')
        ]
        
        file_path = filedialog.askopenfilename(
            title="画像ファイルを選択してください",
            filetypes=file_types
        )
        
        if file_path:
            self.current_image_path = file_path
            self.display_image(file_path)
            self.ocr_button.config(state='normal')
            self.handwriting_button.config(state='normal')
            self.status_var.set(f"画像を選択しました: {os.path.basename(file_path)}")
            
    def display_image(self, image_path):
        """選択した画像を表示"""
        try:
            # 画像を開いてリサイズ
            image = Image.open(image_path)
            # 表示用にリサイズ（最大300x300）
            image.thumbnail((300, 300), Image.Resampling.LANCZOS)
            
            # tkinter用に変換
            photo = ImageTk.PhotoImage(image)
            
            # ラベルに表示
            self.image_label.config(image=photo, text="")
            self.image_label.image = photo  # 参照を保持
            
        except Exception as e:
            messagebox.showerror("エラー", f"画像の表示に失敗しました:\n{str(e)}")
            
    def start_ocr(self):
        """OCR処理を開始（別スレッドで実行）"""
        if not self.current_image_path:
            messagebox.showwarning("警告", "まず画像を選択してください")
            return
            
        # ボタンを無効化
        self.ocr_button.config(state='disabled')
        self.status_var.set("文字を読み取り中...")
        
        # 別スレッドでOCR実行
        threading.Thread(target=self.perform_ocr, daemon=True).start()
        
    def start_handwriting_ocr(self):
        """手書き文字OCR処理を開始（別スレッドで実行）"""
        if not self.current_image_path:
            messagebox.showwarning("警告", "まず画像を選択してください")
            return
            
        # ボタンを無効化
        self.handwriting_button.config(state='disabled')
        self.ocr_button.config(state='disabled')
        self.status_var.set("手書き文字を読み取り中...")
        
        # 別スレッドで手書き文字OCR実行
        threading.Thread(target=self.perform_handwriting_ocr, daemon=True).start()
        
    def perform_ocr(self):
        """OCR処理を実行"""
        try:
            # 画像を開く
            image = Image.open(self.current_image_path)
            
            # OCR実行（日本語と英語を指定）
            text = pytesseract.image_to_string(image, lang='jpn+eng')
            
            # メインスレッドでUI更新
            self.root.after(0, self.ocr_completed, text)
            
        except Exception as e:
            self.root.after(0, self.ocr_error, str(e))
            
    def preprocess_image_for_handwriting(self, image_path):
        """手書き文字認識用の画像前処理"""
        # OpenCVで画像を読み込み
        img = cv2.imread(image_path)
        
        # グレースケール変換
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # ノイズ除去
        denoised = cv2.medianBlur(gray, 3)
        
        # コントラスト強化
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(denoised)
        
        # 二値化（適応的閾値処理）
        binary = cv2.adaptiveThreshold(enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
        
        # モルフォロジー処理でノイズ除去
        kernel = np.ones((2,2), np.uint8)
        cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        
        # PILイメージに変換
        processed_image = Image.fromarray(cleaned)
        
        # さらにPILでシャープ化
        processed_image = processed_image.filter(ImageFilter.SHARPEN)
        
        return processed_image

    def perform_handwriting_ocr(self):
        """手書き文字OCR処理を実行"""
        try:
            # 画像前処理を実行
            processed_image = self.preprocess_image_for_handwriting(self.current_image_path)
            
            # 複数のOCR設定を試行
            ocr_configs = [
                # 設定1: 単一テキストブロック、高精度
                r'--oem 1 --psm 6 -c tessedit_char_blacklist=|[]{}()<>',
                # 設定2: 単語レベル認識
                r'--oem 1 --psm 8 -c tessedit_char_blacklist=|[]{}()<>',
                # 設定3: 行レベル認識
                r'--oem 1 --psm 7 -c tessedit_char_blacklist=|[]{}()<>',
                # 設定4: 自動ページ分割
                r'--oem 1 --psm 3 -c tessedit_char_blacklist=|[]{}()<>',
            ]
            
            results = []
            
            # 各設定で認識を試行
            for config in ocr_configs:
                try:
                    text = pytesseract.image_to_string(processed_image, lang='jpn+eng', config=config)
                    if text.strip():
                        results.append(text.strip())
                except:
                    continue
            
            # 最も長い結果を選択（通常、最も多くの文字を認識できた結果）
            if results:
                best_result = max(results, key=len)
            else:
                # フォールバック: 基本設定で再試行
                best_result = pytesseract.image_to_string(processed_image, lang='jpn+eng')
            
            # 後処理: 不要な文字を除去
            cleaned_text = self.post_process_handwriting_text(best_result)
            
            # メインスレッドでUI更新
            self.root.after(0, self.handwriting_ocr_completed, cleaned_text)
            
        except Exception as e:
            self.root.after(0, self.handwriting_ocr_error, str(e))
    
    def post_process_handwriting_text(self, text):
        """手書き文字認識結果の後処理"""
        # 不要な文字や記号を除去
        import re
        
        # 明らかに誤認識された文字パターンを修正
        text = re.sub(r'[|\\/_~`]', '', text)  # よく誤認識される記号を除去
        text = re.sub(r'\s+', ' ', text)  # 複数の空白を単一の空白に
        text = re.sub(r'^\s+|\s+$', '', text)  # 先頭末尾の空白を除去
        
        # 連続する同じ文字の除去（誤認識でよく発生）
        text = re.sub(r'(.)\1{3,}', r'\1', text)
        
        return text
            
    def ocr_completed(self, text):
        """OCR完了時の処理"""
        self.extracted_text = text
        self.text_area.delete(1.0, tk.END)
        self.text_area.insert(1.0, text)
        
        self.ocr_button.config(state='normal')
        self.handwriting_button.config(state='normal')
        self.save_button.config(state='normal')
        
        if text.strip():
            self.status_var.set("文字の読み取りが完了しました")
        else:
            self.status_var.set("文字が検出されませんでした")
            
    def handwriting_ocr_completed(self, text):
        """手書き文字OCR完了時の処理"""
        self.extracted_text = text
        self.text_area.delete(1.0, tk.END)
        self.text_area.insert(1.0, text)
        
        self.ocr_button.config(state='normal')
        self.handwriting_button.config(state='normal')
        self.save_button.config(state='normal')
        
        if text.strip():
            self.status_var.set("手書き文字の読み取りが完了しました")
        else:
            self.status_var.set("手書き文字が検出されませんでした")
            
    def ocr_error(self, error_message):
        """OCRエラー時の処理"""
        self.ocr_button.config(state='normal')
        self.handwriting_button.config(state='normal')
        self.status_var.set("文字読み取りでエラーが発生しました")
        messagebox.showerror("エラー", f"文字読み取りに失敗しました:\n{error_message}")
        
    def handwriting_ocr_error(self, error_message):
        """手書き文字OCRエラー時の処理"""
        self.ocr_button.config(state='normal')
        self.handwriting_button.config(state='normal')
        self.status_var.set("手書き文字読み取りでエラーが発生しました")
        messagebox.showerror("エラー", f"手書き文字読み取りに失敗しました:\n{error_message}")
        
    def save_text(self):
        """読み取ったテキストを保存"""
        if not self.extracted_text.strip():
            messagebox.showwarning("警告", "保存するテキストがありません")
            return
            
        # 保存先を選択
        file_path = filedialog.asksaveasfilename(
            title="テキストファイルを保存",
            defaultextension=".txt",
            filetypes=[('テキストファイル', '*.txt'), ('すべてのファイル', '*.*')]
        )
        
        if file_path:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(self.extracted_text)
                
                self.status_var.set(f"テキストを保存しました: {os.path.basename(file_path)}")
                messagebox.showinfo("完了", "テキストファイルを保存しました")
                
            except Exception as e:
                messagebox.showerror("エラー", f"ファイルの保存に失敗しました:\n{str(e)}")

def main():
    """メイン関数"""
    try:
        root = tk.Tk()
        # MacOSでのGUI表示を強制
        root.lift()
        root.attributes('-topmost', True)
        root.after_idle(root.attributes, '-topmost', False)
        
        app = OCRアプリ(root)
        root.mainloop()
    except Exception as e:
        print(f"アプリケーション起動エラー: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
