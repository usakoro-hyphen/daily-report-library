import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, addDoc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// Firebase設定
const firebaseConfig = {
    apiKey: "AIzaSyBQsh9Hk6GioHVLGpoIqmeD0TNmjLutOrU",
    authDomain: "daily-report-library.firebaseapp.com",
    projectId: "daily-report-library",
    storageBucket: "daily-report-library.firebasestorage.app",
    messagingSenderId: "284127164108",
    appId: "1:284127164108:web:d07f39c7d8eedc9082f469"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/**
 * パスワードのSHA-256ハッシュを計算する
 */
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const PASSWORD_HASH = '2fc0ab5a112e0d01518d2e2a3e4b97df5f3002f09917be92c1da90cf007a72c6';
const APIKEY_PASSWORD_HASH = '1ea4e50a12ad6f9e31c1683b84c9ec9fb001b2563542c715c0a41bf296af2c03';

/**
 * Gemini Vision OCRクラス
 * Google Gemini APIを使用した高精度OCR
 */
class GeminiOCR {
    static API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
    static MODEL = 'gemini-2.0-flash';
    static cachedApiKey = null;

    static async getApiKey() {
        if (this.cachedApiKey) return this.cachedApiKey;
        try {
            const docSnap = await getDoc(doc(db, 'config', 'app'));
            if (docSnap.exists() && docSnap.data().geminiApiKey) {
                this.cachedApiKey = docSnap.data().geminiApiKey;
                return this.cachedApiKey;
            }
        } catch (error) {
            console.error('APIキー取得エラー:', error);
        }
        return '';
    }

    static async setApiKey(key) {
        await setDoc(doc(db, 'config', 'app'), { geminiApiKey: key }, { merge: true });
        this.cachedApiKey = key;
    }

    static resizeImage(imageDataUrl, maxWidth = 1600) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            img.src = imageDataUrl;
        });
    }

    static async recognize(imageDataUrl) {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('Gemini APIキーが設定されていません。設定画面からAPIキーを入力してください。');
        }

        const mimeType = imageDataUrl.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
        const isHeic = mimeType === 'image/heic' || mimeType === 'image/heif';
        const base64Image = isHeic ? imageDataUrl.split(',')[1] : await this.resizeImage(imageDataUrl);
        const url = `${this.API_BASE}/models/${this.MODEL}:generateContent?key=${apiKey}`;

        const requestBody = {
            contents: [{
                parts: [
                    {
                        inline_data: {
                            mime_type: isHeic ? mimeType : 'image/jpeg',
                            data: base64Image
                        }
                    },
                    {
                        text: `この画像に含まれるすべてのテキストを正確に読み取って出力してください。

ルール:
- 画像内のテキストをそのまま忠実に書き起こしてください
- レイアウトや改行はできるだけ元の構造を保ってください
- 重要: 各項目（各用語の説明）の間には必ず空行（空の行）を1行入れてください。項目の区切りを明確にしてください
- 段落間や項目間にスペースがある場合は、出力でも必ず空行を保持してください
- 読み取れない文字がある場合は「[判読不能]」と記載してください
- テキスト以外の説明や補足は不要です。読み取ったテキストのみを出力してください
- 日本語と英語が混在している場合は両方正確に読み取ってください
- 画像内に黒い太い横線（黒い帯）がある場合は、黒い帯と黒い帯の間にあるテキストのみを書き起こしてください。黒い帯の外側にあるテキストは無視してください`
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4096
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Gemini API エラー: ${message}`);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error('Gemini APIからテキストを取得できませんでした');
        }

        return { text, model: this.MODEL };
    }

    static async getReadings(words) {
        const apiKey = await this.getApiKey();
        if (!apiKey || words.length === 0) return {};

        const url = `${this.API_BASE}/models/${this.MODEL}:generateContent?key=${apiKey}`;
        const wordList = words.join('、');
        const requestBody = {
            contents: [{
                parts: [{
                    text: `以下の日本語用語の読み仮名をひらがなで返してください。必ずJSON形式のみで返してください。説明や補足は不要です。
形式: {"用語1": "よみがな1", "用語2": "よみがな2"}

用語: ${wordList}`
                }]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2048
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) return {};
            const data = await response.json();
            let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            // JSONブロックを抽出
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } catch (error) {
            console.error('読み仮名取得エラー:', error);
        }
        return {};
    }
}

class TextLibrary {
    // 設定値
    static WORDS_PER_PAGE = 3;
    static LIBRARY_PER_PAGE = 3;
    static TIPS_PER_PAGE = 3;
    static RECOMMEND_COUNT = 3;

    constructor() {
        this.currentText = '';
        this.currentTitle = '';
        this.library = [];
        this.wordLibrary = [];
        this.tipsLibrary = [];
        this.tipsCurrentPage = 1;
        this.activeTipsGenre = 'all';

        this.cameraStream = null;
        this.capturedImageData = null;

        this.initializeElements();
        this._initialPlaceholderHtml = this.textDisplay.innerHTML;
        this.bindEvents();
        this.setupRealtimeSync();
        this.loadDeleteBtnState();
        this.loadEditModeState();
    }

    initializeElements() {
        this.loadBtnInline = document.getElementById('loadBtnInline');
        this.saveToLibraryBtn = document.getElementById('saveToLibraryBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.backToEditBtn = document.getElementById('backToEditBtn');
        this.clearLibraryBtn = document.getElementById('clearLibraryBtn');
        this.clearWordLibraryBtn = document.getElementById('clearWordLibraryBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');

        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsModal = document.getElementById('settingsModal');
        this.closeSettingsModalBtn = document.getElementById('closeSettingsModal');
        this.geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
        this.toggleApiKeyVisibilityBtn = document.getElementById('toggleApiKeyVisibility');
        this.saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
        this.testApiKeyBtn = document.getElementById('testApiKeyBtn');
        this.apiTestResult = document.getElementById('apiTestResult');
        this.toggleDeleteBtns = document.getElementById('toggleDeleteBtns');

        this.cameraBtn = document.getElementById('cameraBtn');
        this.ocrModal = document.getElementById('ocrModal');
        this.closeOcrModalBtn = document.getElementById('closeOcrModal');
        this.cameraVideo = document.getElementById('cameraVideo');
        this.captureCanvas = document.getElementById('captureCanvas');
        this.captureBtn = document.getElementById('captureBtn');
        this.retakeBtn = document.getElementById('retakeBtn');
        this.recognizeBtn = document.getElementById('recognizeBtn');
        this.ocrResult = document.querySelector('.ocr-result');
        this.ocrResultText = document.getElementById('ocrResultText');
        this.editOcrBtn = document.getElementById('editOcrBtn');
        this.saveOcrBtn = document.getElementById('saveOcrBtn');
        this.cancelOcrBtn = document.getElementById('cancelOcrBtn');

        this.dropZone = document.getElementById('dropZone');
        this.contentArea = document.getElementById('contentArea');
        this.libraryArea = document.getElementById('libraryArea');
        this.wordLibraryArea = document.getElementById('wordLibraryArea');

        this.documentTitle = document.getElementById('documentTitle');
        this.textDisplay = document.getElementById('textDisplay');
        this.libraryGrid = document.getElementById('libraryGrid');
        this.wordLibraryGrid = document.getElementById('wordLibraryGrid');

        this.wordDetail = document.getElementById('wordDetail');
        this.wordDetailTitle = document.getElementById('wordDetailTitle');
        this.wordDetailContent = document.getElementById('wordDetailContent');
        this.closeWordDetail = document.getElementById('closeWordDetail');

        this.wordSearch = document.getElementById('wordSearch');
        this.librarySearch = document.getElementById('librarySearch');

        this.gojuonFilter = document.getElementById('gojuonFilter');
        this.activeGojuonRow = 'all';
        this.wordCurrentPage = 1;

        this.libraryCurrentPage = 1;

        this.toggleEditMode = document.getElementById('toggleEditMode');

        this.fileInput = document.getElementById('fileInput');

        this.helpBtn = document.getElementById('helpBtn');
        this.helpModal = document.getElementById('helpModal');
        this.closeHelpModalBtn = document.getElementById('closeHelpModal');

        this.apiKeyLocked = document.getElementById('apiKeyLocked');
        this.apiKeyUnlocked = document.getElementById('apiKeyUnlocked');
        this.apiKeyActions = document.getElementById('apiKeyActions');
        this.apiKeyPasswordInput = document.getElementById('apiKeyPasswordInput');
        this.unlockApiKeyBtn = document.getElementById('unlockApiKeyBtn');

        this.fileViewModal = document.getElementById('fileViewModal');
        this.fileViewTitle = document.getElementById('fileViewTitle');
        this.fileViewContent = document.getElementById('fileViewContent');
        this.closeFileViewModalBtn = document.getElementById('closeFileViewModal');

        this.wordLinkModal = document.getElementById('wordLinkModal');
        this.wordLinkModalTitle = document.getElementById('wordLinkModalTitle');
        this.wordLinkModalContent = document.getElementById('wordLinkModalContent');
        this.closeWordLinkModalBtn = document.getElementById('closeWordLinkModal');

        this.tipsGrid = document.getElementById('tipsGrid');
        this.tipsSearch = document.getElementById('tipsSearch');
        this.tipsGenreFilter = document.getElementById('tipsGenreFilter');
        this.clearTipsLibraryBtn = document.getElementById('clearTipsLibraryBtn');

        this.imageFileBtn = document.getElementById('imageFileBtn');
        this.imageFileInput = document.getElementById('imageFileInput');

        // フラッシュカード
        this.startFlashcardBtn = document.getElementById('startFlashcardBtn');
        this.flashcardStandby = document.getElementById('flashcardStandby');
        this.flashcardSessionEl = document.getElementById('flashcardSession');
        this.flashcardCompleteEl = document.getElementById('flashcardComplete');
        this.flashcardEmptyEl = document.getElementById('flashcardEmpty');
        this.flashcardEl = document.getElementById('flashcard');
        this.flashcardTerm = document.getElementById('flashcardTerm');
        this.flashcardReading = document.getElementById('flashcardReading');
        this.flashcardTermBack = document.getElementById('flashcardTermBack');
        this.flashcardExplanation = document.getElementById('flashcardExplanation');
        this.flashcardProgressText = document.getElementById('flashcardProgressText');
        this.flashcardRatingArea = document.getElementById('flashcardRatingArea');
        this.flashcardCompleteStats = document.getElementById('flashcardCompleteStats');
        this.flashcardSession = null;
    }

    bindEvents() {
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettingsModalBtn.addEventListener('click', () => this.closeSettings());
        this.saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        this.testApiKeyBtn.addEventListener('click', () => this.testApiKey());
        this.toggleApiKeyVisibilityBtn.addEventListener('click', () => this.toggleApiKeyVisibility());
        this.toggleDeleteBtns.addEventListener('change', () => this.handleDeleteBtnToggle());
        this.toggleEditMode.addEventListener('change', () => this.handleEditModeToggle());

        this.helpBtn.addEventListener('click', () => this.helpModal.classList.remove('hidden'));
        this.closeHelpModalBtn.addEventListener('click', () => this.helpModal.classList.add('hidden'));
        this.helpModal.addEventListener('click', (e) => { if (e.target === this.helpModal) this.helpModal.classList.add('hidden'); });

        this.unlockApiKeyBtn.addEventListener('click', () => this.unlockApiKey());
        this.apiKeyPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.unlockApiKey(); });

        this.closeFileViewModalBtn.addEventListener('click', () => this.fileViewModal.classList.add('hidden'));
        this.fileViewModal.addEventListener('click', (e) => { if (e.target === this.fileViewModal) this.fileViewModal.classList.add('hidden'); });

        this.closeWordLinkModalBtn.addEventListener('click', () => this.wordLinkModal.classList.add('hidden'));
        this.wordLinkModal.addEventListener('click', (e) => { if (e.target === this.wordLinkModal) this.wordLinkModal.classList.add('hidden'); });

        this.loadBtnInline.addEventListener('click', () => this.openFileDialog());

        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
        this.dropZone.addEventListener('click', () => this.fileInput.click());

        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        this.saveToLibraryBtn.addEventListener('click', () => this.saveToLibrary());

        // Enterキーでライブラリに保存（テキスト表示中のみ）
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.ocrModal.classList.contains('hidden')) { this.closeOcrModal(); return; }
                if (!this.settingsModal.classList.contains('hidden')) { this.closeSettings(); return; }
                if (!this.helpModal.classList.contains('hidden')) { this.helpModal.classList.add('hidden'); return; }
                if (!this.wordLinkModal.classList.contains('hidden')) { this.wordLinkModal.classList.add('hidden'); return; }
                if (!this.fileViewModal.classList.contains('hidden')) { this.fileViewModal.classList.add('hidden'); return; }
            }
            if (e.key === 'Enter' && !this.ocrModal.classList.contains('hidden') && !this.recognizeBtn.classList.contains('hidden') && !this.recognizeBtn.disabled && this.ocrResult.classList.contains('hidden')) {
                e.preventDefault();
                this.recognizeText();
                return;
            }
            if (e.key === 'Enter' && !e.target.matches('input, textarea') && this.currentText && !this.saveToLibraryBtn.disabled) {
                e.preventDefault();
                this.saveToLibrary();
            }
        });
        this.clearBtn.addEventListener('click', () => this.clearContent());
        this.backToEditBtn.addEventListener('click', () => this.backToOcrEdit());

        this.cameraBtn.addEventListener('click', () => this.openOcrModal());
        this.closeOcrModalBtn.addEventListener('click', (e) => { e.stopPropagation(); this.closeOcrModal(); });
        this.ocrModal.addEventListener('click', (e) => { if (e.target === this.ocrModal) this.closeOcrModal(); });
        this.captureBtn.addEventListener('click', () => this.captureImage());
        this.retakeBtn.addEventListener('click', () => this.retakeImage());
        this.recognizeBtn.addEventListener('click', () => this.recognizeText());
        this.imageFileBtn.addEventListener('click', () => { this.imageFileInput.value = ''; this.imageFileInput.click(); });
        this.imageFileInput.addEventListener('change', (e) => this.handleImageFile(e));
        this.editOcrBtn.addEventListener('click', () => this.editOcrText());
        this.saveOcrBtn.addEventListener('click', () => this.saveOcrText());
        this.cancelOcrBtn.addEventListener('click', () => this.closeOcrModal());

        this.clearLibraryBtn.addEventListener('click', () => this.clearLibrary());
        this.clearWordLibraryBtn.addEventListener('click', () => this.clearWordLibrary());
        this.clearTipsLibraryBtn.addEventListener('click', () => this.clearTipsLibrary());
        this.clearAllBtn.addEventListener('click', () => this.clearAll());

        this.wordSearch.addEventListener('input', () => this.searchWords());
        this.librarySearch.addEventListener('input', () => this.searchLibrary());

        this.gojuonFilter.addEventListener('click', (e) => {
            const btn = e.target.closest('.gojuon-btn');
            if (!btn) return;
            this.gojuonFilter.querySelectorAll('.gojuon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.activeGojuonRow = btn.dataset.row;
            this.wordCurrentPage = 1;
            this.wordSearch.value = '';
            this.updateWordLibraryDisplay();
        });
        // 初期表示を「おすすめ」にする
        this.activeGojuonRow = 'recommend';
        this.gojuonFilter.querySelectorAll('.gojuon-btn').forEach(b => b.classList.toggle('active', b.dataset.row === 'recommend'));

        this.closeWordDetail.addEventListener('click', () => this.hideWordDetail());

        this.tipsSearch.addEventListener('input', () => {
            this.tipsCurrentPage = 1;
            this.updateTipsDisplay(this.tipsSearch.value);
        });
        this.tipsGenreFilter.addEventListener('click', (e) => {
            const btn = e.target.closest('.genre-btn');
            if (!btn) return;
            this.tipsGenreFilter.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.activeTipsGenre = btn.dataset.genre;
            this.tipsCurrentPage = 1;
            this.tipsSearch.value = '';
            this.updateTipsDisplay();
        });

        // フラッシュカード
        this.startFlashcardBtn.addEventListener('click', () => this.startFlashcardSession());
        this.flashcardEl.addEventListener('click', () => this.flipCard());
        this.flashcardEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.flipCard(); } });
        document.getElementById('rateHard').addEventListener('click', () => this.rateCard(1));
        document.getElementById('rateNormal').addEventListener('click', () => this.rateCard(3));
        document.getElementById('rateEasy').addEventListener('click', () => this.rateCard(5));
        document.getElementById('flashcardRestartBtn').addEventListener('click', () => this.startFlashcardSession());
        document.getElementById('flashcardEmptyCloseBtn').addEventListener('click', () => this.resetFlashcardUI());
    }

    // Firestoreリアルタイム同期
    setupRealtimeSync() {
        const libraryQuery = query(collection(db, 'library'), orderBy('createdAt', 'desc'));
        onSnapshot(libraryQuery, (snapshot) => {
            this.library = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            this.updateLibraryDisplay();
        }, (error) => {
            console.error('ライブラリ同期エラー:', error);
            this.showMessage('データ同期エラーが発生しました', 'error');
        });

        const wordQuery = query(collection(db, 'wordLibrary'), orderBy('lastSeen', 'desc'));
        onSnapshot(wordQuery, (snapshot) => {
            this.wordLibrary = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            this.updateWordLibraryDisplay();
        }, (error) => {
            console.error('ワードライブラリ同期エラー:', error);
        });

        const tipsQuery = query(collection(db, 'tipsLibrary'), orderBy('createdAt', 'desc'));
        onSnapshot(tipsQuery, (snapshot) => {
            this.tipsLibrary = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            this.updateTipsDisplay();
        }, (error) => {
            console.error('Tipsライブラリ同期エラー:', error);
        });
    }

    openFileDialog() { this.fileInput.click(); }

    handleDragOver(e) { e.preventDefault(); this.dropZone.classList.add('dragover'); }
    handleDragLeave(e) { e.preventDefault(); this.dropZone.classList.remove('dragover'); }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
        this.processFiles(Array.from(e.dataTransfer.files));
    }

    handleFileSelect(e) { this.processFiles(Array.from(e.target.files)); }

    processFiles(files) {
        const textFiles = files.filter(file => file.name.endsWith('.txt'));
        if (textFiles.length === 0) {
            this.showMessage('テキストファイル（.txt）を選択してください', 'error');
            return;
        }
        const file = textFiles[0];
        const reader = new FileReader();
        reader.onload = (e) => this.loadTextContent(e.target.result, file.name);
        reader.onerror = () => this.showMessage('ファイルの読み込みに失敗しました', 'error');
        reader.readAsText(file, 'UTF-8');
    }

    loadTextContent(text, filename) {
        const formattedText = text
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n\n\n')
            .replace(/([。！？])(?=\n)/g, '$1')
            .replace(/^([・•]\s*)/gm, '• ')
            .replace(/^(\d+)\.?\s+(?![…＝=])/gm, '$1. ')
            .replace(/\n{3,}/g, '\n\n===BLOCK_SEPARATOR===\n\n')
            .trim();
        this.currentText = formattedText;
        this.currentTitle = filename;
        this.lastOcrText = null;
        this.backToEditBtn.classList.add('hidden');
        this.displayContent(true);
    }

    renderBlocksToHtml(content, highlightTerm = '') {
        const blocks = content.split('===BLOCK_SEPARATOR===');
        let htmlContent = '';
        blocks.forEach((block, index) => {
            if (block.trim()) {
                let cleanBlock = block.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
                cleanBlock = this.escapeHtml(cleanBlock);
                cleanBlock = cleanBlock.replace(/([^…＝\s]+)([…＝=])/g, '<span class="term">$1</span>$2');
                if (highlightTerm) {
                    const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    cleanBlock = cleanBlock.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="search-highlight">$1</mark>');
                }
                if (cleanBlock) {
                    htmlContent += `<p class="text-paragraph">${cleanBlock}</p>`;
                }
                if (index < blocks.length - 1) {
                    htmlContent += '<div class="block-separator"></div>';
                }
            }
        });
        return htmlContent;
    }

    displayContent(editable = false, highlightTerm = '') {
        this.documentTitle.textContent = this.currentTitle;
        this.textDisplay.innerHTML = this.renderBlocksToHtml(this.currentText, highlightTerm);
        this.textDisplay.contentEditable = editable;
        if (editable) {
            this.textDisplay.classList.add('editable');
            if (this._inputHandler) {
                this.textDisplay.removeEventListener('input', this._inputHandler);
            }
            this._inputHandler = () => {
                this.currentText = this.textDisplay.innerText.trim();
            };
            this.textDisplay.addEventListener('input', this._inputHandler);
        } else {
            this.textDisplay.classList.remove('editable');
        }
        this.enableContentActions();
        this.textDisplay.classList.add('slide-up');
        setTimeout(() => this.textDisplay.classList.remove('slide-up'), 300);
    }

    enableContentActions() {
        if (this.saveToLibraryBtn) this.saveToLibraryBtn.disabled = false;
        if (this.clearBtn) this.clearBtn.disabled = false;
        if (this.cameraBtn) this.cameraBtn.disabled = false;
    }

    disableContentActions() {
        if (this.saveToLibraryBtn) this.saveToLibraryBtn.disabled = true;
        if (this.clearBtn) this.clearBtn.disabled = true;
        if (this.cameraBtn) this.cameraBtn.disabled = true;
    }

    clearContent() {
        this.currentText = '';
        this.currentTitle = '';
        this.documentTitle.textContent = '読み込み/保存';
        this.textDisplay.contentEditable = false;
        this.textDisplay.classList.remove('editable');
        if (this._inputHandler) {
            this.textDisplay.removeEventListener('input', this._inputHandler);
            this._inputHandler = null;
        }
        this.textDisplay.innerHTML = this._initialPlaceholderHtml;
        this.disableContentActions();
        this.rebindPlaceholderElements();
        this.lastOcrText = null;
        this.backToEditBtn.classList.add('hidden');
        this.showMessage('コンテンツをクリアしました', 'info');
    }

    rebindPlaceholderElements() {
        // innerHTML復元後にDOM参照を再取得し、イベントを再バインドする
        // 対象: dropZone, fileInput, loadBtnInline, cameraBtn
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.loadBtnInline = document.getElementById('loadBtnInline');
        this.cameraBtn = document.getElementById('cameraBtn');
        this.imageFileBtn = document.getElementById('imageFileBtn');
        this.imageFileInput = document.getElementById('imageFileInput');

        if (this.dropZone) {
            this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
            this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
            this.dropZone.addEventListener('click', () => this.fileInput.click());
        }
        if (this.fileInput) {
            this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }
        if (this.loadBtnInline) {
            this.loadBtnInline.addEventListener('click', () => this.openFileDialog());
        }
        if (this.cameraBtn) {
            this.cameraBtn.addEventListener('click', () => this.openOcrModal());
        }
        if (this.imageFileBtn) {
            this.imageFileBtn.addEventListener('click', () => { this.imageFileInput.value = ''; this.imageFileInput.click(); });
        }
        if (this.imageFileInput) {
            this.imageFileInput.addEventListener('change', (e) => this.handleImageFile(e));
        }
    }

    async saveToLibrary() {
        if (!this.currentText || this.isSaving) return;
        this.isSaving = true;
        this.saveToLibraryBtn.disabled = true;
        try {
            await addDoc(collection(db, 'library'), {
                title: this.currentTitle || '無題',
                content: this.currentText,
                createdAt: new Date().toISOString()
            });
            await this.extractAndSaveWordsFromText(this.currentText, this.currentTitle);
            this.textDisplay.contentEditable = false;
            this.textDisplay.classList.remove('editable');
            this.showMessage(`「${this.currentTitle}」をライブラリに保存しました`, 'success');
            setTimeout(() => this.clearContent(), 1000);
        } catch (error) {
            console.error('保存エラー:', error);
            this.showMessage('保存に失敗しました', 'error');
            this.saveToLibraryBtn.disabled = false;
        } finally {
            this.isSaving = false;
        }
    }

    loadFromLibrary(item) {
        const content = item.content || item.text || '';
        const searchTerm = this.librarySearch.value.trim();

        // モーダルにタイトル設定
        this.fileViewTitle.textContent = item.title;

        this.fileViewContent.innerHTML = this.renderBlocksToHtml(content, searchTerm);

        // モーダル表示
        this.fileViewModal.classList.remove('hidden');

        // ワード抽出も実行
        this.extractAndSaveWordsFromText(content, item.title);
    }

    async deleteFromLibrary(id) {
        if (!confirm('本当に削除しますか？')) return;
        try {
            const item = this.library.find(item => item.id === id);
            await deleteDoc(doc(db, 'library', id));
            if (item) this.showMessage(`「${item.title}」を削除しました`, 'info');
        } catch (error) {
            console.error('削除エラー:', error);
            this.showMessage('削除に失敗しました', 'error');
        }
    }

    async clearLibrary() {
        const password = await this.promptPassword('ライブラリをクリアするにはパスワードを入力してください:');
        if (password === null) return;
        if (await hashPassword(password) !== PASSWORD_HASH) { this.showMessage('パスワードが正しくありません', 'error'); return; }
        if (!confirm('本当にライブラリをクリアしますか？この操作は元に戻せません。')) return;
        try {
            const snapshot = await getDocs(collection(db, 'library'));
            const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'library', d.id)));
            await Promise.all(deletePromises);
            this.showMessage('ライブラリをクリアしました', 'info');
        } catch (error) {
            console.error('クリアエラー:', error);
            this.showMessage('クリアに失敗しました', 'error');
        }
    }

    containsKanji(str) {
        return /[\u4E00-\u9FFF]/.test(str);
    }

    extractExplanationFromText(word, delimiter, text) {
        const escapedWord = this.escapeRegex(word);
        const escapedDelim = this.escapeRegex(delimiter);
        const idx = text.search(new RegExp(escapedWord + escapedDelim));
        if (idx === -1) return '';
        const afterDelimiter = text.substring(idx + word.length + delimiter.length);
        const endMatch = afterDelimiter.search(/\n{2,}|(?=\n\S+[…＝=])/);
        const explanation = endMatch === -1 ? afterDelimiter : afterDelimiter.substring(0, endMatch);
        return explanation.trim();
    }

    async extractAndSaveWordsFromText(text, title) {
        const cleanText = text.replace(/===BLOCK_SEPARATOR===/g, '\n');
        const termRegex = /([^…＝=\s]+)([…＝=])/g;
        const matches = [...cleanText.matchAll(termRegex)];
        const validMatches = matches.filter(m => m[1].trim().length > 0);

        // 漢字を含む用語で、まだreadingが未設定のものを収集
        const kanjiWords = validMatches
            .map(m => m[1].trim())
            .filter(w => this.containsKanji(w) && !this.wordLibrary.find(existing => existing.word === w && existing.reading));
        const uniqueKanjiWords = [...new Set(kanjiWords)];

        // 一括で読み仮名を取得
        let readings = {};
        if (uniqueKanjiWords.length > 0) {
            readings = await GeminiOCR.getReadings(uniqueKanjiWords);
        }

        const conflicts = [];
        for (const match of validMatches) {
            const word = match[1].trim();
            const delimiter = match[2];
            const reading = readings[word] || '';
            const newExplanation = this.extractExplanationFromText(word, delimiter, cleanText);
            const conflict = await this.saveToWordLibrary(word, delimiter, title, reading, newExplanation);
            if (conflict) conflicts.push(conflict);
        }

        if (conflicts.length > 0) {
            await this.showDuplicateConflictModal(conflicts, title);
        }

        // Tips抽出: {ジャンル}で始まる行から次の{ジャンル}が来るまでを1つのTipsとして保存
        const lines = cleanText.split('\n').map(l => l.trim());
        let currentTip = null;
        for (const line of lines) {
            const genreMatch = line.match(/^\{([^}]+)\}(.*)/);
            if (genreMatch) {
                if (currentTip) await this.saveToTipsLibrary(currentTip.content, currentTip.genre, title);
                currentTip = { genre: genreMatch[1].trim(), content: genreMatch[2].trim() };
            } else if (currentTip && line) {
                currentTip.content += '\n' + line;
            }
        }
        if (currentTip) await this.saveToTipsLibrary(currentTip.content, currentTip.genre, title);
    }

    async saveToWordLibrary(word, delimiter, sourceTitle, reading = '', newExplanation = '') {
        const existingWord = this.wordLibrary.find(w => w.word === word);
        if (existingWord) {
            const oldExplanation = existingWord.explanation || this.findWordExplanation(existingWord.word);
            if (newExplanation && oldExplanation && oldExplanation !== '説明が見つかりませんでした。') {
                const normalize = s => s.replace(/\s+/g, ' ').trim();
                if (normalize(newExplanation) !== normalize(oldExplanation)) {
                    return { existingWord, oldExplanation, newExplanation, newDelimiter: delimiter, newReading: reading, newSourceTitle: sourceTitle };
                }
            }
            try {
                const updateData = {
                    ...existingWord,
                    lastSeen: new Date().toISOString(),
                    delimiters: [...new Set([...existingWord.delimiters, delimiter])]
                };
                if (reading && !existingWord.reading) updateData.reading = reading;
                await setDoc(doc(db, 'wordLibrary', existingWord.id), updateData);
            } catch (error) {
                console.error('ワード更新エラー:', error);
            }
        } else {
            try {
                const wordData = {
                    word,
                    delimiters: [delimiter],
                    sourceTitle,
                    createdAt: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                };
                if (reading) wordData.reading = reading;
                if (newExplanation) wordData.explanation = newExplanation;
                await addDoc(collection(db, 'wordLibrary'), wordData);
            } catch (error) {
                console.error('ワード保存エラー:', error);
            }
        }
        return null;
    }

    showDuplicateConflictModal(conflicts, newSourceTitle) {
        return new Promise((resolve) => {
            const choices = new Map();
            conflicts.forEach((_, i) => choices.set(i, 'old'));

            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay centered';
            const modal = document.createElement('div');
            modal.className = 'conflict-modal-box';

            const itemsHtml = conflicts.map((c, i) => `
                <div class="conflict-item" data-index="${i}">
                    <div class="conflict-word-name">「${this.escapeHtml(c.existingWord.word)}」</div>
                    <div class="conflict-label">現在の説明</div>
                    <div class="conflict-explanation-block">${this.escapeHtml(c.oldExplanation)}</div>
                    <div class="conflict-label">新しい説明（${this.escapeHtml(newSourceTitle)}）</div>
                    <div class="conflict-explanation-block conflict-new">${this.escapeHtml(c.newExplanation)}</div>
                    <div class="conflict-actions">
                        <button class="conflict-btn selected-old" data-index="${i}" data-choice="old">現在を維持</button>
                        <button class="conflict-btn" data-index="${i}" data-choice="new">新しい説明を使う</button>
                    </div>
                </div>
            `).join('');

            modal.innerHTML = `
                <h3 style="margin:0 0 0.5rem;font-size:1rem;">用語の重複が検出されました（${conflicts.length}件）</h3>
                <p style="font-size:0.82rem;color:#64748b;margin:0 0 1rem;">同名の用語が既に保存されています。それぞれ説明文をどちらにするか選択してください。</p>
                ${itemsHtml}
                <div class="conflict-footer">
                    <button class="btn secondary conflict-all-old" style="font-size:0.82rem;">すべて現在を維持</button>
                    <button class="btn secondary conflict-all-new" style="font-size:0.82rem;">すべて新しい説明に更新</button>
                    <button class="btn primary conflict-confirm" style="font-size:0.82rem;">確定</button>
                </div>
            `;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            modal.addEventListener('click', async (e) => {
                const choiceBtn = e.target.closest('.conflict-btn');
                if (choiceBtn) {
                    const idx = parseInt(choiceBtn.dataset.index);
                    const choice = choiceBtn.dataset.choice;
                    choices.set(idx, choice);
                    const item = modal.querySelector(`.conflict-item[data-index="${idx}"]`);
                    item.querySelectorAll('.conflict-btn').forEach(b => b.classList.remove('selected-old', 'selected-new'));
                    choiceBtn.classList.add(choice === 'old' ? 'selected-old' : 'selected-new');
                    return;
                }
                if (e.target.closest('.conflict-all-old')) {
                    conflicts.forEach((_, i) => {
                        choices.set(i, 'old');
                        const item = modal.querySelector(`.conflict-item[data-index="${i}"]`);
                        item.querySelectorAll('.conflict-btn').forEach(b => b.classList.remove('selected-old', 'selected-new'));
                        item.querySelector('[data-choice="old"]').classList.add('selected-old');
                    });
                    return;
                }
                if (e.target.closest('.conflict-all-new')) {
                    conflicts.forEach((_, i) => {
                        choices.set(i, 'new');
                        const item = modal.querySelector(`.conflict-item[data-index="${i}"]`);
                        item.querySelectorAll('.conflict-btn').forEach(b => b.classList.remove('selected-old', 'selected-new'));
                        item.querySelector('[data-choice="new"]').classList.add('selected-new');
                    });
                    return;
                }
                if (e.target.closest('.conflict-confirm')) {
                    overlay.remove();
                    for (const [i, choice] of choices) {
                        const conflict = conflicts[i];
                        try {
                            const updateData = {
                                ...conflict.existingWord,
                                lastSeen: new Date().toISOString(),
                                delimiters: [...new Set([...conflict.existingWord.delimiters, conflict.newDelimiter])]
                            };
                            if (conflict.newReading && !conflict.existingWord.reading) updateData.reading = conflict.newReading;
                            if (choice === 'new') {
                                updateData.explanation = conflict.newExplanation;
                                updateData.sourceTitle = conflict.newSourceTitle;
                            }
                            await setDoc(doc(db, 'wordLibrary', conflict.existingWord.id), updateData);
                        } catch (error) {
                            console.error('ワード更新エラー:', error);
                        }
                    }
                    resolve();
                }
            });
        });
    }

    async deleteFromWordLibrary(id) {
        if (!confirm('本当にこの用語を削除しますか？')) return;
        try {
            const word = this.wordLibrary.find(w => w.id === id);
            await deleteDoc(doc(db, 'wordLibrary', id));
            if (word) this.showMessage(`「${word.word}」を削除しました`, 'info');
        } catch (error) {
            console.error('削除エラー:', error);
            this.showMessage('削除に失敗しました', 'error');
        }
    }

    async clearWordLibrary() {
        const password = await this.promptPassword('ワードライブラリをクリアするにはパスワードを入力してください:');
        if (password === null) return;
        if (await hashPassword(password) !== PASSWORD_HASH) { this.showMessage('パスワードが正しくありません', 'error'); return; }
        if (!confirm('本当にワードライブラリをクリアしますか？この操作は元に戻せません。')) return;
        try {
            const snapshot = await getDocs(collection(db, 'wordLibrary'));
            const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'wordLibrary', d.id)));
            await Promise.all(deletePromises);
            this.showMessage('ワードライブラリをクリアしました', 'info');
        } catch (error) {
            console.error('クリアエラー:', error);
            this.showMessage('クリアに失敗しました', 'error');
        }
    }

    async clearAll() {
        const password = await this.promptPassword('すべてのデータを削除するにはパスワードを入力してください:');
        if (password === null) return;
        if (await hashPassword(password) !== PASSWORD_HASH) { this.showMessage('パスワードが正しくありません', 'error'); return; }
        if (!confirm('本当にすべてのデータを削除しますか？\n・ワードライブラリ\n・Tipsライブラリ\n・テキストファイルライブラリ\n\nこの操作は元に戻せません。')) return;
        try {
            const libSnapshot = await getDocs(collection(db, 'library'));
            const wordSnapshot = await getDocs(collection(db, 'wordLibrary'));
            const tipsSnapshot = await getDocs(collection(db, 'tipsLibrary'));
            const deletePromises = [
                ...libSnapshot.docs.map(d => deleteDoc(doc(db, 'library', d.id))),
                ...wordSnapshot.docs.map(d => deleteDoc(doc(db, 'wordLibrary', d.id))),
                ...tipsSnapshot.docs.map(d => deleteDoc(doc(db, 'tipsLibrary', d.id)))
            ];
            await Promise.all(deletePromises);
            this.clearContent();
            this.showMessage('すべてのデータを削除しました', 'info');
        } catch (error) {
            console.error('全削除エラー:', error);
            this.showMessage('削除に失敗しました', 'error');
        }
    }

    async saveToTipsLibrary(content, genre, sourceTitle) {
        const normalize = s => s.replace(/\s+/g, '');
        const existing = this.tipsLibrary.find(t => normalize(t.content) === normalize(content));
        if (existing) {
            try {
                await setDoc(doc(db, 'tipsLibrary', existing.id), { ...existing, lastSeen: new Date().toISOString() });
            } catch (error) { console.error('Tips更新エラー:', error); }
        } else {
            try {
                await addDoc(collection(db, 'tipsLibrary'), {
                    content, genre, sourceTitle,
                    createdAt: new Date().toISOString(),
                    lastSeen: new Date().toISOString()
                });
            } catch (error) { console.error('Tips保存エラー:', error); }
        }
    }

    async deleteFromTipsLibrary(id) {
        if (!confirm('本当にこのTipsを削除しますか？')) return;
        try {
            await deleteDoc(doc(db, 'tipsLibrary', id));
            this.showMessage('Tipsを削除しました', 'info');
        } catch (error) {
            console.error('Tips削除エラー:', error);
            this.showMessage('削除に失敗しました', 'error');
        }
    }

    async clearTipsLibrary() {
        const password = await this.promptPassword('Tipsライブラリをクリアするにはパスワードを入力してください:');
        if (password === null) return;
        if (await hashPassword(password) !== PASSWORD_HASH) { this.showMessage('パスワードが正しくありません', 'error'); return; }
        if (!confirm('本当にTipsライブラリをクリアしますか？この操作は元に戻せません。')) return;
        try {
            const snapshot = await getDocs(collection(db, 'tipsLibrary'));
            await Promise.all(snapshot.docs.map(d => deleteDoc(doc(db, 'tipsLibrary', d.id))));
            this.showMessage('Tipsライブラリをクリアしました', 'info');
        } catch (error) {
            console.error('クリアエラー:', error);
            this.showMessage('クリアに失敗しました', 'error');
        }
    }

    updateTipsDisplay(searchTerm = '') {
        this.tipsGrid.innerHTML = '';
        document.getElementById('tipsPaginationContainer').innerHTML = '';

        let filtered = this.tipsLibrary;
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(t => t.content.toLowerCase().includes(term) || (t.genre || '').toLowerCase().includes(term));
            this.activeTipsGenre = 'all';
            this.tipsCurrentPage = 1;
            this.tipsGenreFilter.querySelectorAll('.genre-btn').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
        }
        if (this.activeTipsGenre !== 'all') {
            filtered = filtered.filter(t => (t.genre || '未分類') === this.activeTipsGenre);
        }

        // ジャンルボタンを更新
        const genres = [...new Set(this.tipsLibrary.map(t => t.genre || '未分類'))].sort();
        const currentBtns = [...this.tipsGenreFilter.querySelectorAll('.genre-btn[data-genre]')].map(b => b.dataset.genre);
        const allGenres = ['all', ...genres];
        if (JSON.stringify(currentBtns) !== JSON.stringify(allGenres)) {
            this.tipsGenreFilter.innerHTML = '';
            allGenres.forEach(g => {
                const btn = document.createElement('button');
                btn.className = 'genre-btn' + (g === this.activeTipsGenre ? ' active' : '');
                btn.dataset.genre = g;
                btn.textContent = g === 'all' ? '全て' : g;
                this.tipsGenreFilter.appendChild(btn);
            });
        }

        if (filtered.length === 0) {
            this.tipsGrid.innerHTML = '<p class="placeholder">Tipsがありません</p>';
            return;
        }

        const totalPages = Math.ceil(filtered.length / TextLibrary.TIPS_PER_PAGE);
        if (this.tipsCurrentPage > totalPages) this.tipsCurrentPage = totalPages;
        const start = (this.tipsCurrentPage - 1) * TextLibrary.TIPS_PER_PAGE;
        filtered.slice(start, start + TextLibrary.TIPS_PER_PAGE).forEach(tip => this.tipsGrid.appendChild(this.createTipsItem(tip)));

        this.renderPagination('tipsPaginationContainer', totalPages, this.tipsCurrentPage, (page) => {
            this.tipsCurrentPage = page;
            this.updateTipsDisplay(this.tipsSearch.value);
        });
    }

    createTipsItem(tip) {
        const preview = tip.content.length > 20 ? tip.content.slice(0, 20) + '…' : tip.content;
        const div = document.createElement('div');
        div.className = 'library-item tips-item';
        div.innerHTML = `
            <div class="library-item-actions">
                <button class="edit-btn" data-id="${tip.id}">✏️</button>
                <button class="delete-btn" data-id="${tip.id}">×</button>
            </div>
            <span class="tips-genre-badge">${this.escapeHtml(tip.genre || '未分類')}</span>
            <p class="tips-content">${this.escapeHtml(preview)}</p>
            <p class="library-item-date">ソース: ${this.escapeHtml(tip.sourceTitle || '不明')}</p>
        `;
        div.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn') || e.target.classList.contains('edit-btn')) return;
            this.fileViewTitle.textContent = tip.genre || '未分類';
            this.fileViewContent.innerHTML = `<p style="white-space:pre-wrap">${this.escapeHtml(tip.content)}</p>`;
            this.fileViewModal.classList.remove('hidden');
        });
        div.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); this.deleteFromTipsLibrary(tip.id); });
        div.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); this.editTipsItem(tip); });
        return div;
    }

    async editTipsItem(tip) {
        const newContent = prompt('内容を編集:', tip.content);
        if (newContent === null || newContent.trim() === '') return;
        const newGenre = prompt('ジャンルを編集:', tip.genre || '未分類');
        if (newGenre === null) return;
        try {
            await setDoc(doc(db, 'tipsLibrary', tip.id), {
                ...tip,
                content: newContent.trim(),
                genre: newGenre.trim() || '未分類',
                lastSeen: new Date().toISOString()
            });
            this.showMessage('Tipsを更新しました', 'success');
        } catch (error) {
            console.error('Tips編集エラー:', error);
            this.showMessage('更新に失敗しました', 'error');
        }
    }

    updateLibraryDisplay(searchTerm = '') {
        this.libraryGrid.innerHTML = '';
        document.getElementById('libraryPaginationContainer').innerHTML = '';
        let filteredItems = this.library;
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            filteredItems = this.library.filter(item =>
                item.title.toLowerCase().includes(term) ||
                (item.content || item.text || '').toLowerCase().includes(term)
            );
            this.libraryCurrentPage = 1;
        }
        if (filteredItems.length === 0) {
            this.libraryGrid.innerHTML = '<p class="placeholder">テキストファイルライブラリにテキストがありません</p>';
            return;
        }
        const totalPages = Math.ceil(filteredItems.length / TextLibrary.LIBRARY_PER_PAGE);
        if (this.libraryCurrentPage > totalPages) this.libraryCurrentPage = totalPages;
        const start = (this.libraryCurrentPage - 1) * TextLibrary.LIBRARY_PER_PAGE;
        const pageItems = filteredItems.slice(start, start + TextLibrary.LIBRARY_PER_PAGE);
        pageItems.forEach(item => this.libraryGrid.appendChild(this.createLibraryItem(item)));
        this.renderPagination('libraryPaginationContainer', totalPages, this.libraryCurrentPage, (page) => {
            this.libraryCurrentPage = page;
            this.updateLibraryDisplay(this.librarySearch.value);
        });
    }

    renderPagination(containerId, totalPages, currentPage, onPageChange) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'word-pagination';
        const addBtn = (text, page, isActive = false, isDisabled = false) => {
            const btn = document.createElement('button');
            btn.className = `pagination-btn${isActive ? ' active' : ''}`;
            btn.textContent = text;
            btn.disabled = isDisabled;
            if (!isDisabled) btn.addEventListener('click', () => onPageChange(page));
            paginationDiv.appendChild(btn);
        };
        const atFirst = currentPage === 1;
        const atLast = currentPage === totalPages;
        addBtn('«', 1, false, atFirst);
        addBtn('‹', currentPage - 1, false, atFirst);
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        startPage = Math.max(1, endPage - 4);
        for (let i = startPage; i <= endPage; i++) addBtn(i, i, i === currentPage);
        addBtn('›', currentPage + 1, false, atLast);
        addBtn('»', totalPages, false, atLast);
        container.appendChild(paginationDiv);
    }

    createLibraryItem(item) {
        const div = document.createElement('div');
        div.className = 'library-item';
        const content = item.content || item.text || '';
        div.innerHTML = `
            <div class="library-item-actions">
                <button class="edit-btn" data-id="${item.id}">✏️</button>
                <button class="delete-btn" data-id="${item.id}">×</button>
            </div>
            <h3 class="library-item-title">${this.escapeHtml(item.title)}</h3>
            <p class="library-item-preview">${this.escapeHtml(this.createPreview(content))}</p>
            <p class="library-item-date">${this.formatDate(item.createdAt)}</p>
        `;
        div.addEventListener('click', (e) => { if (!e.target.classList.contains('delete-btn') && !e.target.classList.contains('edit-btn')) this.loadFromLibrary(item); });
        div.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); this.deleteFromLibrary(item.id); });
        div.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); this.editLibraryItem(item); });
        return div;
    }

    // 用語のフィルター判定用の先頭文字を取得（readingがあればそちらを優先）
    getFilterChar(word) {
        if (word.reading) return word.reading.charAt(0);
        return word.word ? word.word.charAt(0) : '';
    }

    // 50音行のマッピング
    getGojuonChars(row) {
        const map = {
            'あ': 'あいうえおアイウエオ',
            'か': 'かきくけこがぎぐげごカキクケコガギグゲゴ',
            'さ': 'さしすせそざじずぜぞサシスセソザジズゼゾ',
            'た': 'たちつてとだぢづでどタチツテトダヂヅデド',
            'な': 'なにぬねのナニヌネノ',
            'は': 'はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ',
            'ま': 'まみむめもマミムメモ',
            'や': 'やゆよヤユヨ',
            'ら': 'らりるれろラリルレロ',
            'わ': 'わをんワヲン',
        };
        return map[row] || '';
    }

    updateWordLibraryDisplay(searchTerm = '') {
        this.wordLibraryGrid.innerHTML = '';
        // ページネーションをクリア
        document.getElementById('wordPaginationContainer').innerHTML = '';
        let filteredWords = this.wordLibrary;
        if (searchTerm.trim()) {
            filteredWords = this.wordLibrary.filter(word => word.word.toLowerCase().includes(searchTerm.toLowerCase()));
            // テキスト検索時は50音フィルターとページをリセット
            this.activeGojuonRow = 'all';
            this.wordCurrentPage = 1;
            this.gojuonFilter.querySelectorAll('.gojuon-btn').forEach(b => b.classList.toggle('active', b.dataset.row === 'all'));
        }
        // 50音フィルター適用（readingがあればそちらの先頭文字で判定。おすすめ・新着は全用語対象）
        if (this.activeGojuonRow && this.activeGojuonRow !== 'all' && this.activeGojuonRow !== 'recommend' && this.activeGojuonRow !== 'new') {
            if (this.activeGojuonRow === 'alpha') {
                filteredWords = filteredWords.filter(word => {
                    const ch = this.getFilterChar(word);
                    return ch && /^[a-zA-Z]/.test(ch);
                });
            } else if (this.activeGojuonRow === 'numsym') {
                filteredWords = filteredWords.filter(word => {
                    const ch = this.getFilterChar(word);
                    return ch && /^[^a-zA-Zぁ-んァ-ヶ\u4E00-\u9FFF]/.test(ch);
                });
            } else {
                const chars = this.getGojuonChars(this.activeGojuonRow);
                filteredWords = filteredWords.filter(word => {
                    const ch = this.getFilterChar(word);
                    return ch && chars.includes(ch);
                });
            }
        }
        if (filteredWords.length === 0) {
            const rowLabels = { 'alpha': 'A~Z', 'numsym': '数字/記号', 'recommend': 'おすすめ', 'new': '新着' };
            const label = rowLabels[this.activeGojuonRow] || `「${this.activeGojuonRow}」行`;
            const msg = this.activeGojuonRow !== 'all' && this.activeGojuonRow !== 'recommend' && this.activeGojuonRow !== 'new' ? `${label}の用語がありません` : 'ワードライブラリに用語がありません';
            this.wordLibraryGrid.innerHTML = `<p class="placeholder">${msg}</p>`;
            return;
        }

        // おすすめ: ランダム3件（ページネーションなし）
        if (this.activeGojuonRow === 'recommend') {
            const randomWords = this.getRandomWords(filteredWords, TextLibrary.RECOMMEND_COUNT);
            randomWords.forEach(word => this.wordLibraryGrid.appendChild(this.createWordLibraryItem(word)));
            return;
        }

        // 新着: wordLibraryに最後に追加された用語のsourceTitleと一致する用語を全件表示
        if (this.activeGojuonRow === 'new') {
            const sorted = [...this.wordLibrary].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const latestTitle = sorted[0]?.sourceTitle;
            filteredWords = latestTitle ? this.wordLibrary.filter(w => w.sourceTitle === latestTitle) : [];
        }

        // それ以外: ソート+ページネーション
        let displayWords = [...filteredWords];
        if (this.activeGojuonRow !== 'new') {
            displayWords.sort((a, b) => a.word.localeCompare(b.word, 'ja'));
        }

        const totalPages = Math.ceil(displayWords.length / TextLibrary.WORDS_PER_PAGE);
        if (this.wordCurrentPage > totalPages) this.wordCurrentPage = totalPages;
        const start = (this.wordCurrentPage - 1) * TextLibrary.WORDS_PER_PAGE;
        const pageWords = displayWords.slice(start, start + TextLibrary.WORDS_PER_PAGE);

        pageWords.forEach(word => this.wordLibraryGrid.appendChild(this.createWordLibraryItem(word)));

        this.renderPagination('wordPaginationContainer', totalPages, this.wordCurrentPage, (page) => {
            this.wordCurrentPage = page;
            this.updateWordLibraryDisplay(this.wordSearch.value);
        });
    }

    getRandomWords(words, count) {
        const shuffled = [...words].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, Math.min(count, words.length));
    }

    createWordLibraryItem(word) {
        const div = document.createElement('div');
        div.className = 'library-item word-item';
        div.innerHTML = `
            <div class="library-item-actions">
                <button class="edit-btn" data-id="${word.id}">✏️</button>
                <button class="delete-btn" data-id="${word.id}">×</button>
            </div>
            <h3 class="library-item-title">${this.escapeHtml(word.word)}</h3>
            <p class="library-item-preview">ソース: ${this.escapeHtml(word.sourceTitle || '不明')}</p>
            <p class="library-item-date">最終確認: ${this.formatDate(word.lastSeen)}</p>
        `;
        div.addEventListener('click', (e) => { if (!e.target.classList.contains('delete-btn') && !e.target.classList.contains('edit-btn')) this.showWordDetail(word); });
        div.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); this.deleteFromWordLibrary(word.id); });
        div.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); this.editWordItem(word); });
        return div;
    }

    renderExplanationWithLinks(explanationText, currentWordId) {
        // 現在表示中の用語以外を長い順にソート
        const otherWords = this.wordLibrary
            .filter(w => w.id !== currentWordId && w.word.trim())
            .sort((a, b) => b.word.length - a.word.length);

        // テキストをセグメント配列で管理し、順次用語を検出してリンク化
        let segments = [{ text: explanationText, isLink: false, wordId: null }];
        for (const w of otherWords) {
            const newSegments = [];
            for (const seg of segments) {
                if (seg.isLink) { newSegments.push(seg); continue; }
                const parts = seg.text.split(w.word);
                parts.forEach((part, i) => {
                    if (part) newSegments.push({ text: part, isLink: false });
                    if (i < parts.length - 1) newSegments.push({ text: w.word, isLink: true, wordId: w.id });
                });
            }
            segments = newSegments;
        }

        const seen = new Set();
        return segments.map(seg => {
            if (!seg.isLink) return this.escapeHtml(seg.text);
            if (seen.has(seg.wordId)) return this.escapeHtml(seg.text);
            seen.add(seg.wordId);
            return `<span class="word-link" data-id="${seg.wordId}">${this.escapeHtml(seg.text)}</span>`;
        }).join('');
    }

    showWordDetail(word) {
        this.wordDetailTitle.textContent = word.word;
        const explanationText = word.explanation || this.findWordExplanation(word.word);
        this.wordDetailContent.innerHTML = `
            <div class="word-context"><p>${this.renderExplanationWithLinks(explanationText, word.id)}</p></div>
            <div class="word-meta">
                <p>ソース: ${this.escapeHtml(word.sourceTitle || '不明')}</p>
                <p>最終確認: ${this.formatDate(word.lastSeen)}</p>
            </div>
        `;
        this.wordDetailContent.querySelectorAll('.word-link').forEach(el => {
            el.addEventListener('click', () => {
                const linked = this.wordLibrary.find(w => w.id === el.dataset.id);
                if (linked) this.showWordLinkModal(linked);
            });
        });
        this.wordDetail.classList.remove('hidden');
        // 用語詳細エリアまで自動スクロール
        this.wordDetail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    showWordLinkModal(word) {
        const explanationText = word.explanation || this.findWordExplanation(word.word);
        this.wordLinkModalTitle.textContent = word.word;
        this.wordLinkModalContent.innerHTML = `
            <div class="word-context"><p>${this.renderExplanationWithLinks(explanationText, word.id)}</p></div>
            <div class="word-meta">
                <p>ソース: ${this.escapeHtml(word.sourceTitle || '不明')}</p>
                <p>最終確認: ${this.formatDate(word.lastSeen)}</p>
            </div>
        `;
        this.wordLinkModalContent.querySelectorAll('.word-link').forEach(el => {
            el.addEventListener('click', () => {
                const linked = this.wordLibrary.find(w => w.id === el.dataset.id);
                if (linked) this.showWordLinkModal(linked);
            });
        });
        this.wordLinkModal.classList.remove('hidden');
    }

    hideWordDetail() {
        this.wordDetail.classList.add('hidden');
        // ワードライブラリの検索ボックスあたりまでスクロール
        this.wordLibraryArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    findWordExplanation(word) {
        const wordInfo = this.wordLibrary.find(w => w.word === word);
        if (!wordInfo) return '説明が見つかりませんでした。';
        const libraryItem = this.library.find(item => item.title === wordInfo.sourceTitle);
        if (!libraryItem) return '説明が見つかりませんでした。';
        const content = libraryItem.content || '';
        const escapedWord = this.escapeRegex(word);
        const idx = content.search(new RegExp(`${escapedWord}[…＝=]`));
        if (idx === -1) return '説明が見つかりませんでした。';
        const afterDelimiter = content.substring(idx).replace(new RegExp(`^${escapedWord}[…＝=]`), '');
        const endMatch = afterDelimiter.search(/===BLOCK_SEPARATOR===|(?=\S+[…＝=])/);
        const explanation = endMatch === -1 ? afterDelimiter : afterDelimiter.substring(0, endMatch);
        return explanation.trim() || '説明が見つかりませんでした。';
    }

    searchWords() { this.updateWordLibraryDisplay(this.wordSearch.value); }
    searchLibrary() { this.updateLibraryDisplay(this.librarySearch.value); }

    async openSettings() {
        const password = await this.promptPassword('設定を開くにはパスワードを入力してください:');
        if (password === null) return;
        if (await hashPassword(password) !== PASSWORD_HASH) { this.showMessage('パスワードが正しくありません', 'error'); return; }
        this.settingsModal.classList.remove('hidden');
        // APIキー欄をロック状態にリセット
        this.apiKeyLocked.classList.remove('hidden');
        this.apiKeyUnlocked.classList.add('hidden');
        this.apiKeyActions.classList.add('hidden');
        this.apiKeyPasswordInput.value = '';
        this.geminiApiKeyInput.value = '';
    }

    closeSettings() {
        this.settingsModal.classList.add('hidden');
        this.apiTestResult.classList.add('hidden');
        // APIキー欄をロック状態に戻す
        this.apiKeyLocked.classList.remove('hidden');
        this.apiKeyUnlocked.classList.add('hidden');
        this.apiKeyActions.classList.add('hidden');
        this.apiKeyPasswordInput.value = '';
        this.geminiApiKeyInput.value = '';
    }

    async unlockApiKey() {
        const password = this.apiKeyPasswordInput.value;
        if (!password) return;
        if (await hashPassword(password) !== APIKEY_PASSWORD_HASH) {
            this.showMessage('パスワードが正しくありません', 'error');
            this.apiKeyPasswordInput.value = '';
            return;
        }
        this.apiKeyLocked.classList.add('hidden');
        this.apiKeyUnlocked.classList.remove('hidden');
        this.apiKeyActions.classList.remove('hidden');
        const savedKey = await GeminiOCR.getApiKey();
        if (savedKey) this.geminiApiKeyInput.value = savedKey;
    }

    loadDeleteBtnState() {
        this.toggleDeleteBtns.checked = false;
        document.body.classList.remove('show-delete-btns');
    }

    handleDeleteBtnToggle() {
        const show = this.toggleDeleteBtns.checked;
        document.body.classList.toggle('show-delete-btns', show);
    }

    loadEditModeState() {
        this.toggleEditMode.checked = false;
        document.body.classList.remove('edit-mode');
    }

    handleEditModeToggle() {
        const show = this.toggleEditMode.checked;
        document.body.classList.toggle('edit-mode', show);
        this.updateLibraryDisplay(this.librarySearch.value);
        this.updateWordLibraryDisplay(this.wordSearch.value);
    }

    showEditModal(fields, onSave) {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay centered';
        const modal = document.createElement('div');
        modal.className = 'edit-modal-box';
        let html = '<h3>編集</h3>';
        fields.forEach(f => {
            html += `<label class="edit-modal-label">${this.escapeHtml(f.label)}</label>`;
            if (f.multiline) {
                html += `<textarea class="edit-field edit-modal-input" data-key="${f.key}">${this.escapeHtml(f.value)}</textarea>`;
            } else {
                html += `<input class="edit-field edit-modal-input" data-key="${f.key}" type="text" value="${this.escapeHtml(f.value)}">`;
            }
        });
        html += '<div class="edit-modal-actions">';
        html += '<button class="edit-cancel btn secondary">キャンセル</button>';
        html += '<button class="edit-save btn primary edit-modal-save">保存</button>';
        html += '</div>';
        modal.innerHTML = html;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        modal.querySelector('.edit-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        modal.querySelector('.edit-save').addEventListener('click', async () => {
            const values = {};
            modal.querySelectorAll('.edit-field').forEach(el => { values[el.dataset.key] = el.value; });
            await onSave(values);
            overlay.remove();
        });
    }

    async editLibraryItem(item) {
        const content = (item.content || item.text || '').replace(/===BLOCK_SEPARATOR===/g, '\n\n');
        this.showEditModal([
            { key: 'title', label: 'タイトル', value: item.title, multiline: false },
            { key: 'content', label: '内容', value: content, multiline: true }
        ], async (values) => {
            try {
                await setDoc(doc(db, 'library', item.id), {
                    ...item,
                    title: values.title.trim() || item.title,
                    content: values.content.trim()
                });
                this.showMessage('テキストファイルを更新しました', 'success');
            } catch (error) {
                console.error('編集エラー:', error);
                this.showMessage('更新に失敗しました', 'error');
            }
        });
    }

    async editWordItem(word) {
        const explanation = this.findWordExplanation(word.word);
        this.showEditModal([
            { key: 'word', label: '用語', value: word.word, multiline: false },
            { key: 'explanation', label: '用語の説明', value: word.explanation || explanation, multiline: true }
        ], async (values) => {
            try {
                const updateData = { ...word, word: values.word.trim() || word.word };
                if (values.explanation.trim()) updateData.explanation = values.explanation.trim();
                await setDoc(doc(db, 'wordLibrary', word.id), updateData);
                this.showMessage('用語を更新しました', 'success');
            } catch (error) {
                console.error('編集エラー:', error);
                this.showMessage('更新に失敗しました', 'error');
            }
        });
    }

    async saveApiKey() {
        const key = this.geminiApiKeyInput.value.trim();
        if (!key) { this.showMessage('APIキーを入力してください', 'error'); return; }
        try {
            await GeminiOCR.setApiKey(key);
            this.showMessage('APIキーを保存しました（全デバイスで共有されます）', 'success');
        } catch (error) {
            console.error('APIキー保存エラー:', error);
            this.showMessage('APIキーの保存に失敗しました', 'error');
        }
    }

    async testApiKey() {
        const key = this.geminiApiKeyInput.value.trim();
        if (!key) { this.showMessage('APIキーを入力してください', 'error'); return; }
        this.apiTestResult.classList.remove('hidden');
        this.apiTestResult.textContent = 'テスト中...';
        this.apiTestResult.className = 'api-test-result testing';
        try {
            const url = `${GeminiOCR.API_BASE}/models/${GeminiOCR.MODEL}:generateContent?key=${key}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'こんにちは。一言で返して。' }] }], generationConfig: { maxOutputTokens: 50 } })
            });
            if (response.ok) {
                const data = await response.json();
                const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                this.apiTestResult.textContent = `接続成功！ (${GeminiOCR.MODEL}) 応答: ${reply}`;
                this.apiTestResult.className = 'api-test-result success';
            } else {
                const errorData = await response.json().catch(() => ({}));
                this.apiTestResult.textContent = `エラー: ${errorData?.error?.message || response.status}`;
                this.apiTestResult.className = 'api-test-result error';
            }
        } catch (error) {
            this.apiTestResult.textContent = `接続エラー: ${error.message}`;
            this.apiTestResult.className = 'api-test-result error';
        }
    }

    toggleApiKeyVisibility() {
        const input = this.geminiApiKeyInput;
        if (input.type === 'password') { input.type = 'text'; this.toggleApiKeyVisibilityBtn.textContent = '🔒'; }
        else { input.type = 'password'; this.toggleApiKeyVisibilityBtn.textContent = '👁️'; }
    }

    async openOcrModal() {
        if (!navigator.onLine) {
            this.showMessage('オフラインのためカメラ文字認識は使用できません', 'error');
            return;
        }
        // navigator.onLineが信頼できない場合に備え、実際の接続確認
        try {
            await fetch('https://www.google.com/generate_204', { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
        } catch {
            this.showMessage('オフラインのためカメラ文字認識は使用できません', 'error');
            return;
        }
        this.ocrModal.classList.remove('hidden');
        await this.startCamera();
    }

    closeOcrModal() { this.stopCamera(); this.ocrModal.classList.add('hidden'); this.resetOcrState(); }

    async startCamera() {
        try {
            this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            this.cameraVideo.srcObject = this.cameraStream;
        } catch (error) {
            console.error('カメラ起動エラー:', error);
            this.showMessage('カメラを起動できませんでした', 'error');
            this.closeOcrModal();
        }
    }

    stopCamera() {
        if (this.cameraStream) { this.cameraStream.getTracks().forEach(track => track.stop()); this.cameraStream = null; this.cameraVideo.srcObject = null; }
    }

    captureImage() {
        const canvas = this.captureCanvas;
        const video = this.cameraVideo;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        this.capturedImageData = canvas.toDataURL('image/jpeg');
        this.cameraVideo.classList.add('hidden');
        canvas.classList.remove('hidden');
        this.captureBtn.classList.add('hidden');
        this.retakeBtn.classList.remove('hidden');
        this.recognizeBtn.classList.remove('hidden');
    }

    retakeImage() {
        this.cameraVideo.classList.remove('hidden');
        this.captureCanvas.classList.add('hidden');
        this.captureBtn.classList.remove('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        this.capturedImageData = null;
    }

    async recognizeText() {
        if (!this.capturedImageData) return;
        const apiKey = await GeminiOCR.getApiKey();
        if (!apiKey) { this.showOcrStatus('error', 'APIキーが未設定です。画面上部の設定ボタンからGemini APIキーを入力してください。'); return; }
        this.recognizeBtn.disabled = true;
        this.recognizeBtn.classList.add('ocr-processing');
        this.showOcrStatus('processing', 'Gemini AIで文字認識中...');
        try {
            const result = await GeminiOCR.recognize(this.capturedImageData);
            const filteredText = this.filterOcrRange(result.text);
            if (filteredText.trim()) {
                this.ocrResultText.value = filteredText.trim();
                this.showOcrResult();
                this.showOcrStatus('success', `文字認識完了！(Gemini ${result.model})`);
                this.checkOcrSpaces();
            } else {
                this.showOcrStatus('error', '文字が認識できませんでした。もう一度撮影してください。');
            }
        } catch (error) {
            console.error('OCRエラー:', error);
            const isNetworkError = error instanceof TypeError && error.message?.includes('Failed to fetch');
            const userMessage = isNetworkError
                ? 'オフラインのため文字認識ができません。ネットワーク接続を確認してください。'
                : error.message?.includes('Gemini API')
                    ? 'Gemini APIエラーです。1分ほど待ってから再度撮影をお願いします。'
                    : (error.message || '文字認識でエラーが発生しました');
            this.showOcrStatus('error', userMessage);
        } finally {
            this.recognizeBtn.disabled = false;
            this.recognizeBtn.classList.remove('ocr-processing');
        }
    }

    filterOcrRange(text) {
        const lines = text.split('\n');
        let startIdx = 0;
        let endIdx = lines.length;
        for (let i = 0; i < lines.length; i++) {
            const normalized = lines[i].replace(/\s/g, '');
            if (normalized.includes('本日の気付き') || normalized.includes('本日の気づき')) {
                startIdx = i + 1;
            }
            if (/結果.*感想|感想.*結果/.test(normalized)) {
                endIdx = i;
                break;
            }
        }
        const cleaned = lines.slice(startIdx, endIdx)
            .map(line => line.replace(/^[･・•·‧∙●◦◆■□▪▫]\s*/u, ''))
            .map(line => line.replace(/\.{2,}/g, '…'))
            .map(line => line.replace(/([…＝])\s+/g, '$1'));
        // 用語行（…や＝を含む行）の前に空行がなければ挿入
        const result = [];
        for (let i = 0; i < cleaned.length; i++) {
            const line = cleaned[i];
            if (i > 0 && /[…＝=]/.test(line) && cleaned[i - 1].trim() !== '') {
                result.push('');
            }
            result.push(line);
        }
        return result.join('\n');
    }

    showOcrResult() { this.ocrResult.classList.remove('hidden'); this.ocrResultText.focus(); }

    checkOcrSpaces() {
        const existing = document.getElementById('ocrSpaceWarning');
        if (existing) existing.remove();
        const count = (this.ocrResultText.value.match(/ /g) || []).length;
        if (count === 0) return;
        const warning = document.createElement('div');
        warning.id = 'ocrSpaceWarning';
        warning.style.cssText = 'background:#fef9c3;border:1px solid #fbbf24;border-radius:6px;padding:6px 10px;font-size:0.85rem;color:#92400e;display:flex;align-items:center;gap:8px;margin-top:6px;';
        warning.innerHTML = `⚠️ 半角スペースが${count}箇所含まれています <button id="removeSpacesBtn" style="background:#f59e0b;color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.8rem;">一括削除</button>`;
        this.ocrResult.insertBefore(warning, this.ocrResult.querySelector('.ocr-actions'));
        document.getElementById('removeSpacesBtn').addEventListener('click', () => {
            this.ocrResultText.value = this.ocrResultText.value.replace(/ /g, '');
            warning.remove();
        });
    }

    showOcrStatus(type, message) {
        const existingStatus = this.ocrModal.querySelector('.ocr-status');
        if (existingStatus) existingStatus.remove();
        const statusEl = document.createElement('div');
        statusEl.className = `ocr-status ${type}`;
        statusEl.textContent = message;
        const ocrBody = this.ocrModal.querySelector('.ocr-body');
        ocrBody.insertBefore(statusEl, ocrBody.firstChild);
        if (type !== 'processing') { setTimeout(() => { if (statusEl.parentNode) statusEl.parentNode.removeChild(statusEl); }, 3000); }
    }

    editOcrText() { this.ocrResultText.focus(); this.ocrResultText.select(); }

    handleImageFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            this.capturedImageData = ev.target.result;
            // モーダルをカメラなしで開く
            this.ocrModal.classList.remove('hidden');
            this.cameraVideo.classList.add('hidden');
            this.captureBtn.classList.add('hidden');
            this.retakeBtn.classList.remove('hidden');
            this.recognizeBtn.classList.remove('hidden');
            // HEIC以外はキャンバスにプレビュー表示
            const mimeType = file.type || '';
            const isHeic = mimeType.includes('heic') || mimeType.includes('heif');
            if (!isHeic) {
                const img = new Image();
                img.onload = () => {
                    const canvas = this.captureCanvas;
                    canvas.width = img.width;
                    canvas.height = img.height;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    canvas.classList.remove('hidden');
                };
                img.src = ev.target.result;
            }
        };
        reader.readAsDataURL(file);
    }

    async saveOcrText() {
        const text = this.ocrResultText.value.trim();
        if (!text) { this.showMessage('保存するテキストがありません', 'error'); return; }
        this.lastOcrText = text;
        this.currentText = this.formatText(text);
        this.currentTitle = 'OCR読み取り ' + new Date().toLocaleString('ja-JP');
        this.displayContent(true);
        this.closeOcrModal();
        this.backToEditBtn.classList.remove('hidden');
        this.showMessage('OCR結果を表示しました。ライブラリに保存できます。', 'success');
    }

    backToOcrEdit() {
        this.ocrModal.classList.remove('hidden');
        this.cameraVideo.classList.add('hidden');
        this.captureBtn.classList.add('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        this.ocrResultText.value = this.lastOcrText || '';
        this.showOcrResult();
    }

    resetOcrState() {
        this.cameraVideo.classList.remove('hidden');
        this.captureCanvas.classList.add('hidden');
        this.captureBtn.classList.remove('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        this.ocrResult.classList.add('hidden');
        this.capturedImageData = null;
        this.ocrResultText.value = '';
        const statusMessages = this.ocrModal.querySelectorAll('.ocr-status');
        statusMessages.forEach(msg => msg.remove());
        document.getElementById('ocrSpaceWarning')?.remove();
    }

    createPreview(text) {
        if (!text || typeof text !== 'string') return 'プレビューなし';
        return text.substring(0, 100).replace(/\n/g, ' ') + (text.length > 100 ? '...' : '');
    }

    formatText(text) { return text.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\n\n/g, '\n\n===BLOCK_SEPARATOR===\n\n'); }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
    escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    promptPassword(message) {
        const dialog = document.createElement('div');
        dialog.className = 'dialog-box';
        dialog.innerHTML = `
            <h3>${this.escapeHtml(message)}</h3>
            <input type="password" class="pw-input dialog-input" placeholder="パスワードを入力">
            <div class="dialog-actions">
                <button class="pw-cancel dialog-btn cancel">キャンセル</button>
                <button class="pw-ok dialog-btn ok">OK</button>
            </div>
        `;
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
        const passwordInput = dialog.querySelector('.pw-input');
        passwordInput.focus();
        return new Promise((resolve) => {
            const cleanup = () => { document.body.removeChild(overlay); document.body.removeChild(dialog); document.removeEventListener('keydown', handleKeydown); };
            const handleOk = () => { const pw = passwordInput.value; cleanup(); resolve(pw); };
            const handleCancel = () => { cleanup(); resolve(null); };
            const handleKeydown = (e) => { if (e.key === 'Enter') handleOk(); else if (e.key === 'Escape') handleCancel(); };
            dialog.querySelector('.pw-ok').addEventListener('click', handleOk);
            dialog.querySelector('.pw-cancel').addEventListener('click', handleCancel);
            document.addEventListener('keydown', handleKeydown);
        });
    }

    showMessage(message, type = 'info') {
        const messageEl = document.createElement('div');
        messageEl.className = `toast-message message-${type}`;
        messageEl.textContent = message;
        document.body.appendChild(messageEl);
        setTimeout(() => { messageEl.style.animation = 'slideOutRight 0.3s ease'; setTimeout(() => { if (messageEl.parentNode) messageEl.parentNode.removeChild(messageEl); }, 300); }, 3000);
    }

    // ==================== フラッシュカード ====================

    startFlashcardSession() {
        const today = new Date().toISOString().split('T')[0];
        const NEW_CARDS_PER_SESSION = 10;
        // セッション開始時点でワードライブラリをスナップショット（#6: リアルタイム同期の影響を受けない）
        const snapshot = [...this.wordLibrary];

        // 復習カード: 一度評価済みで今日が期日（#1: デフォルト値を明示処理）
        const reviewCards = snapshot.filter(w => w.sm2_nextReview && w.sm2_nextReview <= today);
        // 新規カード: まだ一度も評価していない → 1セッション最大10枚に制限
        const newCards = snapshot
            .filter(w => !w.sm2_nextReview)
            .sort(() => 0.5 - Math.random())
            .slice(0, NEW_CARDS_PER_SESSION);

        const allDue = [...reviewCards, ...newCards];

        if (allDue.length === 0) {
            // (#3) カードなし状態を表示
            this.flashcardStandby.classList.add('hidden');
            this.flashcardSessionEl.classList.add('hidden');
            this.flashcardCompleteEl.classList.add('hidden');
            this.flashcardEmptyEl.classList.remove('hidden');
            return;
        }

        // 全体をシャッフル
        const queue = allDue.sort(() => 0.5 - Math.random());

        this.flashcardSession = {
            queue,
            currentIndex: 0,
            shownCounts: {},   // id -> 表示回数（#4: 再出題上限管理）
            isFlipped: false,
            stats: { hard: 0, normal: 0, easy: 0 },
            newCount: newCards.length,
            reviewCount: reviewCards.length
        };

        this.flashcardStandby.classList.add('hidden');
        this.flashcardSessionEl.classList.remove('hidden');
        this.flashcardCompleteEl.classList.add('hidden');
        this.flashcardEmptyEl.classList.add('hidden');
        this.showCurrentCard();
    }

    resetFlashcardUI() {
        this.flashcardSession = null;
        this.flashcardStandby.classList.remove('hidden');
        this.flashcardSessionEl.classList.add('hidden');
        this.flashcardCompleteEl.classList.add('hidden');
        this.flashcardEmptyEl.classList.add('hidden');
    }

    showCurrentCard() {
        const session = this.flashcardSession;
        if (!session || session.currentIndex >= session.queue.length) {
            this.endFlashcardSession();
            return;
        }

        const card = session.queue[session.currentIndex];
        const remaining = session.queue.length - session.currentIndex;
        this.flashcardProgressText.textContent = `残り ${remaining} 枚`;

        // 表面
        this.flashcardTerm.textContent = card.word;
        this.flashcardReading.textContent = card.reading || '';
        // 裏面
        this.flashcardTermBack.textContent = card.word;
        const explanation = card.explanation || this.findWordExplanation(card.word);
        this.flashcardExplanation.textContent = explanation;

        // フリップリセット
        session.isFlipped = false;
        this.flashcardEl.classList.remove('flipped');
        this.flashcardRatingArea.classList.add('hidden');
    }

    flipCard() {
        const session = this.flashcardSession;
        if (!session || session.isFlipped) return;
        session.isFlipped = true;
        this.flashcardEl.classList.add('flipped');
        this.flashcardRatingArea.classList.remove('hidden');
    }

    async rateCard(rating) {
        const session = this.flashcardSession;
        if (!session || !session.isFlipped) return;

        // ボタン連打防止
        this.flashcardRatingArea.querySelectorAll('button').forEach(b => b.disabled = true);

        const card = session.queue[session.currentIndex];

        // 統計
        if (rating === 1) session.stats.hard++;
        else if (rating === 3) session.stats.normal++;
        else session.stats.easy++;

        // 表示回数を更新（#4: 再出題上限）
        session.shownCounts[card.id] = (session.shownCounts[card.id] || 0) + 1;

        // SM-2 計算して Firestore に保存（#1, #8）
        const updates = this.calculateSM2Update(card, rating);
        try {
            await setDoc(doc(db, 'wordLibrary', card.id), { ...card, ...updates });
        } catch (error) {
            console.error('SM-2更新エラー:', error);
        }

        // 「難しい」かつ上限未満なら後方に再挿入（#4: MAX 3回まで）
        const MAX_REQUEUE = 3;
        if (rating === 1 && session.shownCounts[card.id] < MAX_REQUEUE) {
            const insertAt = Math.min(session.currentIndex + 3, session.queue.length);
            session.queue.splice(insertAt, 0, card);
        }

        session.currentIndex++;
        this.flashcardRatingArea.querySelectorAll('button').forEach(b => b.disabled = false);
        this.showCurrentCard();
    }

    calculateSM2Update(word, rating) {
        // (#1) 既存フィールドがない場合はデフォルト値を使用
        let interval = word.sm2_interval ?? 0;
        let ease = word.sm2_ease ?? 2.5;
        let repetitions = word.sm2_repetitions ?? 0;

        if (rating < 3) {
            // 難しい: リセット
            repetitions = 0;
            interval = 1;
        } else {
            if (repetitions === 0) interval = 1;
            else if (repetitions === 1) interval = 6;
            else interval = Math.round(interval * ease);
            repetitions++;
        }

        // Ease Factor 更新（#8: 最低値 1.3 を強制）
        ease = ease + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
        ease = Math.max(1.3, Math.round(ease * 100) / 100);

        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + interval);
        const sm2_nextReview = nextReviewDate.toISOString().split('T')[0];

        return { sm2_interval: interval, sm2_ease: ease, sm2_repetitions: repetitions, sm2_nextReview };
    }

    endFlashcardSession() {
        const session = this.flashcardSession;
        const s = session?.stats || { hard: 0, normal: 0, easy: 0 };
        const total = s.hard + s.normal + s.easy;
        const breakdown = [];
        if (session?.newCount) breakdown.push(`新規 ${session.newCount} 枚`);
        if (session?.reviewCount) breakdown.push(`復習 ${session.reviewCount} 枚`);
        this.flashcardCompleteStats.textContent =
            `難しい: ${s.hard} / 普通: ${s.normal} / 簡単: ${s.easy}（${breakdown.join('・')}）`;

        this.flashcardStandby.classList.add('hidden');
        this.flashcardSessionEl.classList.add('hidden');
        this.flashcardCompleteEl.classList.remove('hidden');
        this.flashcardEmptyEl.classList.add('hidden');
        this.flashcardSession = null;
    }
}

document.addEventListener('DOMContentLoaded', () => { new TextLibrary(); });
