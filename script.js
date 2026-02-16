class TextLibrary {
    constructor() {
        this.currentText = '';
        this.currentTitle = '';
        this.library = this.loadLibrary();
        this.wordLibrary = this.loadWordLibrary();
        
        // OCR関連プロパティ
        this.cameraStream = null;
        this.capturedImageData = null;
        this.ocrWorker = null;
        
        this.initializeElements();
        this.bindEvents();
        this.updateLibraryDisplay();
        this.updateWordLibraryDisplay();
    }

    initializeElements() {
        // ボタン
        this.loadBtnInline = document.getElementById('loadBtnInline');
        this.saveToLibraryBtn = document.getElementById('saveToLibraryBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.clearLibraryBtn = document.getElementById('clearLibraryBtn');
        this.clearWordLibraryBtn = document.getElementById('clearWordLibraryBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        
        // OCR関連
        this.cameraBtn = document.getElementById('cameraBtn');
        this.ocrModal = document.getElementById('ocrModal');
        this.closeOcrModal = document.getElementById('closeOcrModal');
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
        
        // エリア
        this.dropZone = document.getElementById('dropZone');
        this.contentArea = document.getElementById('contentArea');
        this.libraryArea = document.getElementById('libraryArea');
        this.wordLibraryArea = document.getElementById('wordLibraryArea');
        
        // コンテンツ
        this.documentTitle = document.getElementById('documentTitle');
        this.textDisplay = document.getElementById('textDisplay');
        this.libraryGrid = document.getElementById('libraryGrid');
        this.wordLibraryGrid = document.getElementById('wordLibraryGrid');
        
        // 用語詳細
        this.wordDetail = document.getElementById('wordDetail');
        this.wordDetailTitle = document.getElementById('wordDetailTitle');
        this.wordDetailContent = document.getElementById('wordDetailContent');
        this.closeWordDetail = document.getElementById('closeWordDetail');
        
        // 検索
        this.wordSearch = document.getElementById('wordSearch');
        this.librarySearch = document.getElementById('librarySearch');
        
        // ファイル入力
        this.fileInput = document.getElementById('fileInput');
        
        // コンテンツアクションボタン
        this.saveToLibraryBtn = document.getElementById('saveToLibraryBtn');
        this.clearBtn = document.getElementById('clearBtn');
    }

    bindEvents() {
        // メインボタン
        this.loadBtnInline.addEventListener('click', () => this.toggleDropZone());
        
        // ドラッグ&ドロップ
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        
        // ファイル入力
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // コンテンツアクション
        this.saveToLibraryBtn.addEventListener('click', () => this.saveToLibrary());
        this.clearBtn.addEventListener('click', () => this.clearContent());
        
        // OCR関連
        this.cameraBtn.addEventListener('click', () => this.openOcrModal());
        this.closeOcrModal.addEventListener('click', () => this.closeOcrModal());
        this.captureBtn.addEventListener('click', () => this.captureImage());
        this.retakeBtn.addEventListener('click', () => this.retakeImage());
        this.recognizeBtn.addEventListener('click', () => this.recognizeText());
        this.editOcrBtn.addEventListener('click', () => this.editOcrText());
        this.saveOcrBtn.addEventListener('click', () => this.saveOcrText());
        this.cancelOcrBtn.addEventListener('click', () => this.closeOcrModal());
        
        // ライブラリ
        this.clearLibraryBtn.addEventListener('click', () => this.clearLibrary());
        this.clearWordLibraryBtn.addEventListener('click', () => this.clearWordLibrary());
        this.clearAllBtn.addEventListener('click', () => this.clearAll());
        
        // ワード検索
        this.wordSearch.addEventListener('input', () => this.searchWords());
        
        // テキストファイルライブラリ検索
        this.librarySearch.addEventListener('input', () => this.searchLibrary());
        
        // 用語詳細
        this.closeWordDetail.addEventListener('click', () => this.hideWordDetail());
    }

    toggleDropZone() {
        // 直接ファイル選択を開く
        this.fileInput.click();
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        this.processFiles(files);
    }

    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }

    processFiles(files) {
        const textFiles = files.filter(file => 
            file.name.endsWith('.txt')  // 拡張子のみで判定
        );
        
        if (textFiles.length === 0) {
            this.showMessage('テキストファイル（.txt）を選択してください', 'error');
            return;
        }

        // 最初のファイルのみを処理
        const file = textFiles[0];
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const content = e.target.result;
            this.loadTextContent(content, file.name);
        };
        
        reader.onerror = () => {
            this.showMessage('ファイルの読み込みに失敗しました', 'error');
        };
        
        reader.readAsText(file, 'UTF-8');
    }

    loadTextContent(text, filename) {
        // テキストを整形して読みやすくする
        const formattedText = text
            // 連続する空白文字を単一のスペースに（ただし改行は保持）
            .replace(/[ \t]+/g, ' ')
            // 空行（1行以上の空行）でテキストの塊を分割
            .replace(/\n{2,}/g, '\n\n\n')
            // 各塊内で句読点後の改行を削除（単語の途中で折り返さない限り段落分けしない）
            .replace(/([。！？])(?=\n)/g, '$1')
            // 箇条書きの整形
            .replace(/^([・•]\s*)/gm, '• ')
            // 数字付きリストの整形
            .replace(/^(\d+)\.?\s*/gm, '$1. ')
            // 塊の区切りをマーク
            .replace(/\n{3,}/g, '\n\n===BLOCK_SEPARATOR===\n\n')
            // 先頭と末尾の空白を削除
            .trim();
        
        // テキストとタイトルを設定して表示
        this.currentText = formattedText;
        this.currentTitle = filename;
        this.displayContent();
    }

    displayContent() {
        this.documentTitle.textContent = this.currentTitle;
        
        // テキストを塊に分割してHTMLとして表示
        const blocks = this.currentText.split('===BLOCK_SEPARATOR===');
        let htmlContent = '';
        
        blocks.forEach((block, index) => {
            if (block.trim()) {
                // 各塊を単一の段落として処理（改行をスペースに変換）
                let cleanBlock = block.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
                
                // …や＝の前の文字列を用語として認識して太字に
                cleanBlock = cleanBlock.replace(/([^…＝\s]+)([…＝])/g, '<span class="term">$1</span>$2');
                
                if (cleanBlock) {
                    htmlContent += `<p class="text-paragraph">${cleanBlock}</p>`;
                }
                
                // 塊の間に広い余白を追加（最後の塊以外）
                if (index < blocks.length - 1) {
                    htmlContent += '<div class="block-separator"></div>';
                }
            }
        });
        
        this.textDisplay.innerHTML = htmlContent;
        
        // 用語抽出はここでは行わない（ライブラリ保存時に行う）
        
        // 既存のコンテンツアクションボタンを有効化
        this.enableContentActions();
        
        this.textDisplay.classList.add('slide-up');
        
        // アニメーションクラスをリセット
        setTimeout(() => {
            this.textDisplay.classList.remove('slide-up');
        }, 300);
    }

    enableContentActions() {
        // 既存のコンテンツアクションボタンを有効化
        if (this.saveToLibraryBtn) {
            this.saveToLibraryBtn.disabled = false;
        }
        if (this.clearBtn) {
            this.clearBtn.disabled = false;
        }
    }

    disableContentActions() {
        // 既存のコンテンツアクションボタンを無効化
        if (this.saveToLibraryBtn) {
            this.saveToLibraryBtn.disabled = true;
        }
        if (this.clearBtn) {
            this.clearBtn.disabled = true;
        }
    }

    clearContent() {
        this.currentText = '';
        this.currentTitle = '';
        
        this.documentTitle.textContent = 'ドキュメントが選択されていません';
        this.textDisplay.innerHTML = '<p class="placeholder">読み込みボタンをクリックしてテキストファイルを読み込んでください</p><div class="placeholder-action"><button id="loadBtnInline" class="btn primary">読み込み</button></div>';
        
        // コンテンツアクションボタンを無効化
        this.disableContentActions();
        
        // イベントリスナーを再設定
        const newInlineBtn = document.getElementById('loadBtnInline');
        if (newInlineBtn) {
            newInlineBtn.addEventListener('click', () => this.toggleDropZone());
        }
        
        this.showMessage('コンテンツをクリアしました', 'info');
    }

    saveToLibrary() {
        console.log('saveToLibraryが呼ばれました');
        console.log('currentText:', this.currentText);
        console.log('currentTitle:', this.currentTitle);
        
        if (!this.currentText) {
            this.showMessage('保存するテキストがありません', 'error');
            return;
        }

        const item = {
            id: Date.now(),
            title: this.currentTitle || '無題',
            content: this.currentText,
            createdAt: new Date().toISOString()
        };

        console.log('保存するアイテム:', item);

        this.library.push(item);
        this.saveLibrary();
        this.updateLibraryDisplay();
        
        // ライブラリ保存時に用語を抽出してワードライブラリに保存
        this.extractAndSaveWordsFromText(this.currentText, this.currentTitle);
        
        this.showMessage(`「${this.currentTitle}」をライブラリに保存しました`, 'success');
        
        // 少し遅延させてクリアを実行し、ポップアップが重ならないようにする
        setTimeout(() => {
            this.clearContent();
        }, 1000);
    }

    extractAndSaveWordsFromText(text, title) {
        // …や＝の前の用語を抽出
        const termRegex = /([^…＝\s]+)([…＝])/g;
        const matches = [...text.matchAll(termRegex)];
        
        matches.forEach(match => {
            const word = match[1].trim();
            if (word.length > 0) {
                this.saveToWordLibrary(word, match[2], title);
            }
        });
    }

    saveToWordLibrary(word, delimiter, sourceTitle) {
        // 既に存在するかチェック
        const existingWord = this.wordLibrary.find(w => w.word === word);
        if (existingWord) {
            // 既に存在する場合は最終確認時刻と区切り文字を更新
            existingWord.lastSeen = new Date().toISOString();
            existingWord.delimiters = [...new Set([...existingWord.delimiters, delimiter])];
        } else {
            // 新しい用語を追加
            const wordItem = {
                id: Date.now() + Math.random(),
                word: word,
                delimiters: [delimiter],
                sourceTitle: sourceTitle,
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString()
            };
            this.wordLibrary.push(wordItem);
        }
        
        this.saveWordLibrary();
        this.updateWordLibraryDisplay();
    }

    createPreview(text) {
        // プレビュー用に最初の100文字程度を抽出
        if (!text || typeof text !== 'string') {
            return 'プレビューなし';
        }
        return text.substring(0, 100).replace(/\n/g, ' ') + (text.length > 100 ? '...' : '');
    }

    loadWordLibrary() {
        const saved = localStorage.getItem('wordLibrary');
        return saved ? JSON.parse(saved) : [];
    }

    saveWordLibrary() {
        localStorage.setItem('wordLibrary', JSON.stringify(this.wordLibrary));
    }

    updateWordLibraryDisplay(searchTerm = '') {
        this.wordLibraryGrid.innerHTML = '';
        
        // 検索フィルター
        let filteredWords = this.wordLibrary;
        if (searchTerm.trim()) {
            filteredWords = this.wordLibrary.filter(word => 
                word.word.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (filteredWords.length === 0) {
            this.wordLibraryGrid.innerHTML = '<p class="placeholder">ワードライブラリに用語がありません</p>';
            return;
        }

        // 検索中はすべて表示、通常時はランダムで3つまで表示
        let displayWords = filteredWords;
        if (!searchTerm.trim()) {
            // ランダムで3つ選出
            displayWords = this.getRandomWords(filteredWords, 3);
        } else {
            // 検索中は最終確認時刻の新しい順にソート
            displayWords.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
        }

        displayWords.forEach(word => {
            const element = this.createWordLibraryItem(word);
            this.wordLibraryGrid.appendChild(element);
        });
    }

    getRandomWords(words, count) {
        // 配列をシャッフルして指定数だけ返す
        const shuffled = [...words].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, Math.min(count, words.length));
    }

    createWordLibraryItem(word) {
        const div = document.createElement('div');
        div.className = 'library-item word-item';
        
        div.innerHTML = `
            <div class="library-item-actions">
                <button class="delete-btn" data-id="${word.id}">×</button>
            </div>
            <h3 class="library-item-title">${this.escapeHtml(word.word)}</h3>
            <p class="library-item-preview">ソース: ${this.escapeHtml(word.sourceTitle || '不明')}</p>
            <p class="library-item-date">最終確認: ${this.formatDate(word.lastSeen)}</p>
        `;

        // 用語をクリックして詳細を表示
        div.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-btn')) {
                this.showWordDetail(word);
            }
        });

        // 削除ボタン
        div.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteFromWordLibrary(word.id);
        });

        return div;
    }

    showWordDetail(word) {
        this.wordDetailTitle.textContent = word.word;
        
        // 用語の説明（区切り文字以降の文章）を検索して表示
        const explanationText = this.findWordExplanation(word.word);
        this.wordDetailContent.innerHTML = `
            <div class="word-info">
                <p><strong>ソース:</strong> ${this.escapeHtml(word.sourceTitle || '不明')}</p>
                <p><strong>最終確認:</strong> ${this.formatDate(word.lastSeen)}</p>
            </div>
            <div class="word-context">
                <h4>用語の説明:</h4>
                <p>${this.escapeHtml(explanationText)}</p>
            </div>
        `;
        
        this.wordDetail.classList.remove('hidden');
    }

    hideWordDetail() {
        this.wordDetail.classList.add('hidden');
    }

    findWordExplanation(word) {
        // ワードライブラリから用語情報を取得
        const wordInfo = this.wordLibrary.find(w => w.word === word);
        if (!wordInfo) {
            return '説明が見つかりませんでした。';
        }
        
        // ソースタイトルから対応するライブラリアイテムを検索
        const libraryItem = this.library.find(item => item.title === wordInfo.sourceTitle);
        if (!libraryItem) {
            return '説明が見つかりませんでした。';
        }
        
        // ライブラリのテキストから用語と区切り文字以降の文章を検索
        const regex = new RegExp(`${this.escapeRegex(word)}[…＝](.{0,100})`, 'g');
        const match = libraryItem.content.match(regex);
        
        if (match && match.length > 0) {
            // 最初のマッチから区切り文字以降の部分を抽出
            const explanation = match[0].replace(new RegExp(`${this.escapeRegex(word)}[…＝]`), '');
            return explanation.trim();
        }
        
        return '説明が見つかりませんでした。';
    }

    promptPassword(message) {
        // 非表示パスワード入力ダイアログを作成
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            z-index: 3000;
            min-width: 300px;
        `;
        
        dialog.innerHTML = `
            <h3 style="margin: 0 0 1rem 0; color: #333;">${message}</h3>
            <input type="password" id="passwordInput" style="
                width: 100%;
                padding: 0.75rem;
                border: 2px solid #e5e7eb;
                border-radius: 8px;
                font-size: 1rem;
                margin-bottom: 1rem;
                box-sizing: border-box;
            " placeholder="パスワードを入力">
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button id="cancelBtn" style="
                    padding: 0.5rem 1rem;
                    border: none;
                    border-radius: 6px;
                    background: #6b7280;
                    color: white;
                    cursor: pointer;
                    font-size: 0.9rem;
                ">キャンセル</button>
                <button id="okBtn" style="
                    padding: 0.5rem 1rem;
                    border: none;
                    border-radius: 6px;
                    background: #3b82f6;
                    color: white;
                    cursor: pointer;
                    font-size: 0.9rem;
                ">OK</button>
            </div>
        `;
        
        // オーバーレイを追加
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 2999;
        `;
        
        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
        
        // 入力フィールドにフォーカス
        const passwordInput = document.getElementById('passwordInput');
        passwordInput.focus();
        
        return new Promise((resolve) => {
            const handleOk = () => {
                const password = passwordInput.value;
                cleanup();
                resolve(password);
            };
            
            const handleCancel = () => {
                cleanup();
                resolve(null);
            };
            
            const cleanup = () => {
                document.body.removeChild(overlay);
                document.body.removeChild(dialog);
                document.removeEventListener('keydown', handleKeydown);
            };
            
            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    handleOk();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };
            
            document.getElementById('okBtn').addEventListener('click', handleOk);
            document.getElementById('cancelBtn').addEventListener('click', handleCancel);
            document.addEventListener('keydown', handleKeydown);
        });
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    searchWords() {
        const searchTerm = this.wordSearch.value;
        this.updateWordLibraryDisplay(searchTerm);
    }

    searchLibrary() {
        const searchTerm = this.librarySearch.value;
        this.updateLibraryDisplay(searchTerm);
    }

    deleteFromWordLibrary(id) {
        if (!confirm('本当にこの用語を削除しますか？')) return;
        
        const index = this.wordLibrary.findIndex(word => word.id === id);
        if (index !== -1) {
            const deletedWord = this.wordLibrary[index];
            this.wordLibrary.splice(index, 1);
            this.saveWordLibrary();
            this.updateWordLibraryDisplay(this.wordSearch.value);
            
            this.showMessage(`「${deletedWord.word}」を削除しました`, 'info');
        }
    }

    async clearWordLibrary() {
        // パスワードを要求（非表示入力）
        const password = await this.promptPassword('ワードライブラリをクリアするにはパスワードを入力してください:');
        
        if (REMOVED_CHECK) {
            if (password !== null) {
                this.showMessage('パスワードが正しくありません', 'error');
            }
            return;
        }
        
        if (!confirm('本当にワードライブラリをクリアしますか？この操作は元に戻せません。')) return;
        
        this.wordLibrary = [];
        this.saveWordLibrary();
        this.updateWordLibraryDisplay();
        
        this.showMessage('ワードライブラリをクリアしました', 'info');
    }

    async clearAll() {
        // パスワードを要求（非表示入力）
        const password = await this.promptPassword('すべてのデータを削除するにはパスワードを入力してください:');
        
        if (REMOVED_CHECK) {
            if (password !== null) {
                this.showMessage('パスワードが正しくありません', 'error');
            }
            return;
        }
        
        if (!confirm('本当にすべてのデータを削除しますか？\n・ワードライブラリ\n・テキストファイルライブラリ\n\nこの操作は元に戻せません。')) return;
        
        // ワードライブラリをクリア
        this.wordLibrary = [];
        this.saveWordLibrary();
        this.updateWordLibraryDisplay();
        
        // テキストファイルライブラリをクリア
        this.library = [];
        this.saveLibrary();
        this.updateLibraryDisplay();
        
        // 表示更新
        this.updateWordLibraryDisplay();
        this.updateLibraryDisplay();
        
        // 現在のコンテンツもクリア
        this.clearContent();
        
        this.showMessage('すべてのデータを削除しました', 'info');
    }

    updateLibraryDisplay(searchTerm = '') {
        this.libraryGrid.innerHTML = '';

        // 検索フィルター
        let filteredItems = this.library;
        if (searchTerm.trim()) {
            filteredItems = this.library.filter(item => 
                item.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (filteredItems.length === 0) {
            this.libraryGrid.innerHTML = '<p class="placeholder">テキストファイルライブラリにテキストがありません</p>';
            return;
        }

        filteredItems.forEach(item => {
            const element = this.createLibraryItem(item);
            this.libraryGrid.appendChild(element);
        });
    }

    createLibraryItem(item) {
        const div = document.createElement('div');
        div.className = 'library-item';
        
        // 古いデータ形式に対応（contentがなければtextを使用）
        const content = item.content || item.text || '';
        
        div.innerHTML = `
            <div class="library-item-actions">
                <button class="delete-btn" data-id="${item.id}">×</button>
            </div>
            <h3 class="library-item-title">${this.escapeHtml(item.title)}</h3>
            <p class="library-item-preview">${this.escapeHtml(this.createPreview(content))}</p>
            <p class="library-item-date">${this.formatDate(item.createdAt)}</p>
        `;

        // クリックでテキストを表示
        div.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-btn')) {
                this.loadFromLibrary(item);
            }
        });

        // 削除ボタン
        div.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteFromLibrary(item.id);
        });

        return div;
    }

    loadFromLibrary(item) {
        // 古いデータ形式に対応（contentがなければtextを使用）
        this.currentText = item.content || item.text || '';
        this.currentTitle = item.title;
        this.displayContent();
        
        this.saveToLibraryBtn.disabled = true;
        this.clearBtn.disabled = false;
        
        this.showMessage(`「${item.title}」をライブラリから読み込みました`, 'success');
        
        // ライブラリから読み込んだ際も用語を抽出（既に存在する場合は重複しない）
        this.extractAndSaveWordsFromText(this.currentText, this.currentTitle);
    }

    deleteFromLibrary(id) {
        if (!confirm('本当に削除しますか？')) return;
        
        const index = this.library.findIndex(item => item.id === id);
        if (index !== -1) {
            const deletedItem = this.library[index];
            this.library.splice(index, 1);
            this.saveLibrary();
            this.updateLibraryDisplay();
            
            this.showMessage(`「${deletedItem.title}」を削除しました`, 'info');
        }
    }

    async clearLibrary() {
        // パスワードを要求（非表示入力）
        const password = await this.promptPassword('ライブラリをクリアするにはパスワードを入力してください:');
        
        if (REMOVED_CHECK) {
            if (password !== null) {
                this.showMessage('パスワードが正しくありません', 'error');
            }
            return;
        }
        
        if (!confirm('本当にライブラリをクリアしますか？この操作は元に戻せません。')) return;
        
        this.library = [];
        this.saveLibrary();
        this.updateLibraryDisplay();
        
        this.showMessage('ライブラリをクリアしました', 'info');
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showMessage(message, type = 'info') {
        // メッセージ表示用の一時的な要素を作成
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type}`;
        messageEl.textContent = message;
        messageEl.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            padding: 0.75rem 1.25rem;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            font-size: 0.9rem;
            z-index: 2000;
            animation: slideInRight 0.3s ease;
            max-width: 280px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        `;

        // 背景色をタイプに応じて設定
        const colors = {
            'success': 'linear-gradient(135deg, #10b981, #059669)',
            'error': 'linear-gradient(135deg, #ef4444, #dc2626)',
            'info': 'linear-gradient(135deg, #3b82f6, #2563eb)'
        };
        messageEl.style.background = colors[type] || colors.info;

        document.body.appendChild(messageEl);

        // 3秒後に自動で削除
        setTimeout(() => {
            messageEl.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 300);
        }, 3000);
    }

    // ローカルストレージ操作
    saveLibrary() {
        localStorage.setItem('textLibrary', JSON.stringify(this.library));
    }

    loadLibrary() {
        const saved = localStorage.getItem('textLibrary');
        return saved ? JSON.parse(saved) : [];
    }

    // OCR機能関連メソッド
    async openOcrModal() {
        this.ocrModal.classList.remove('hidden');
        await this.startCamera();
    }

    closeOcrModal() {
        this.stopCamera();
        this.ocrModal.classList.add('hidden');
        this.resetOcrState();
    }

    async startCamera() {
        try {
            this.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            this.cameraVideo.srcObject = this.cameraStream;
        } catch (error) {
            console.error('カメラ起動エラー:', error);
            this.showMessage('カメラを起動できませんでした', 'error');
            this.closeOcrModal();
        }
    }

    stopCamera() {
        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
            this.cameraVideo.srcObject = null;
        }
    }

    captureImage() {
        const canvas = this.captureCanvas;
        const video = this.cameraVideo;
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        
        this.capturedImageData = canvas.toDataURL('image/jpeg');
        
        // 撮影後のUI変更
        this.cameraVideo.classList.add('hidden');
        canvas.classList.remove('hidden');
        this.captureBtn.classList.add('hidden');
        this.retakeBtn.classList.remove('hidden');
        this.recognizeBtn.classList.remove('hidden');
    }

    retakeImage() {
        // 撮り直しのUI変更
        this.cameraVideo.classList.remove('hidden');
        this.captureCanvas.classList.add('hidden');
        this.captureBtn.classList.remove('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        
        this.capturedImageData = null;
    }

    async recognizeText() {
        if (!this.capturedImageData) return;
        
        this.showOcrStatus('processing', '文字を認識中...');
        this.recognizeBtn.disabled = true;
        this.recognizeBtn.classList.add('ocr-processing');
        
        try {
            // Canvasで画像前処理
            const processedImage = await this.preprocessImage(this.capturedImageData);
            
            // Tesseract.jsでOCR実行
            if (!this.ocrWorker) {
                this.ocrWorker = await Tesseract.createWorker('jpn', 1, {
                    logger: m => console.log(m)
                });
            }
            
            const { data: { text } } = await this.ocrWorker.recognize(processedImage);
            
            if (text.trim()) {
                this.ocrResultText.value = text.trim();
                this.showOcrResult();
                this.showOcrStatus('success', '文字認識が完了しました');
            } else {
                this.showOcrStatus('error', '文字が認識できませんでした。もう一度撮影してください。');
            }
        } catch (error) {
            console.error('OCRエラー:', error);
            this.showOcrStatus('error', '文字認識でエラーが発生しました');
        } finally {
            this.recognizeBtn.disabled = false;
            this.recognizeBtn.classList.remove('ocr-processing');
        }
    }

    async preprocessImage(imageData) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // リサイズ（最大幅800px）
                const maxWidth = 800;
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // グレースケール変換とコントラスト調整
                ctx.drawImage(img, 0, 0, width, height);
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    // グレースケール変換
                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    
                    // コントラスト調整
                    const contrast = 1.5;
                    const adjusted = ((gray / 255 - 0.5) * contrast + 0.5) * 255;
                    const clamped = Math.max(0, Math.min(255, adjusted));
                    
                    data[i] = clamped;
                    data[i + 1] = clamped;
                    data[i + 2] = clamped;
                }
                
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = imageData;
        });
    }

    showOcrResult() {
        this.ocrResult.classList.remove('hidden');
        this.ocrResultText.focus();
    }

    showOcrStatus(type, message) {
        // 既存のステータスメッセージを削除
        const existingStatus = this.ocrModal.querySelector('.ocr-status');
        if (existingStatus) {
            existingStatus.remove();
        }
        
        // 新しいステータスメッセージを追加
        const statusEl = document.createElement('div');
        statusEl.className = 'ocr-status ' + type;
        statusEl.textContent = message;
        
        const ocrBody = this.ocrModal.querySelector('.ocr-body');
        ocrBody.insertBefore(statusEl, ocrBody.firstChild);
        
        // 3秒後に自動削除
        if (type !== 'processing') {
            setTimeout(() => {
                if (statusEl.parentNode) {
                    statusEl.parentNode.removeChild(statusEl);
                }
            }, 3000);
        }
    }

    editOcrText() {
        this.ocrResultText.focus();
        this.ocrResultText.select();
    }

    async saveOcrText() {
        const text = this.ocrResultText.value.trim();
        if (!text) {
            this.showMessage('保存するテキストがありません', 'error');
            return;
        }
        
        // 現在のテキストとして設定
        this.currentText = this.formatText(text);
        this.currentTitle = 'OCR読み取り ' + new Date().toLocaleString('ja-JP');
        
        // 表示を更新
        this.displayContent();
        
        // モーダルを閉じる
        this.closeOcrModal();
        
        this.showMessage('OCR結果を表示しました。ライブラリに保存できます。', 'success');
    }

    resetOcrState() {
        // UI状態をリセット
        this.cameraVideo.classList.remove('hidden');
        this.captureCanvas.classList.add('hidden');
        this.captureBtn.classList.remove('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        this.ocrResult.classList.add('hidden');
        
        // データをリセット
        this.capturedImageData = null;
        this.ocrResultText.value = '';
        
        // ステータスメッセージを削除
        statusEl.className = `ocr-status ${type}`;
        statusEl.textContent = message;
        
        const ocrBody = this.ocrModal.querySelector('.ocr-body');
        ocrBody.insertBefore(statusEl, ocrBody.firstChild);
        
        // 3秒後に自動削除
        if (type !== 'processing') {
            setTimeout(() => {
                if (statusEl.parentNode) {
                    statusEl.parentNode.removeChild(statusEl);
                }
            }, 3000);
        }
    }

    editOcrText() {
        this.ocrResultText.focus();
        this.ocrResultText.select();
    }

    async saveOcrText() {
        const text = this.ocrResultText.value.trim();
        if (!text) {
            this.showMessage('保存するテキストがありません', 'error');
            return;
        }
        
        // 現在のテキストとして設定
        this.currentText = this.formatText(text);
        this.currentTitle = `OCR読み取り ${new Date().toLocaleString('ja-JP')}`;
        
        // 表示を更新
        this.displayContent();
        
        // モーダルを閉じる
        this.closeOcrModal();
        
        this.showMessage('OCR結果を表示しました。ライブラリに保存できます。', 'success');
    }

    resetOcrState() {
        // UI状態をリセット
        this.cameraVideo.classList.remove('hidden');
        this.captureCanvas.classList.add('hidden');
        this.captureBtn.classList.remove('hidden');
        this.retakeBtn.classList.add('hidden');
        this.recognizeBtn.classList.add('hidden');
        this.ocrResult.classList.add('hidden');
        
        // データをリセット
        this.capturedImageData = null;
        this.ocrResultText.value = '';
        
        // ステータスメッセージを削除
        const statusMessages = this.ocrModal.querySelectorAll('.ocr-status');
        statusMessages.forEach(msg => msg.remove());
    }
}

// アニメーション用のCSSを動的に追加
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(style);

// アプリケーションを初期化
document.addEventListener('DOMContentLoaded', () => {
    new TextLibrary();
});
