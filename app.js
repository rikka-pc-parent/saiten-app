// ==========================================
// DOM要素の取得
// ==========================================
const subjectButtons = document.getElementById('subjectButtons');
const statusBox = document.getElementById('status');
const resultText = document.getElementById('resultText');
const gradeButton = document.getElementById('gradeButton');
const cameraButton = document.getElementById('cameraButton');
const galleryButton = document.getElementById('galleryButton');
const imageInput = document.getElementById('imageInput');
const galleryInput = document.getElementById('galleryInput');
const webcamPanel = document.getElementById('webcamPanel');
const cameraPreview = document.getElementById('cameraPreview');
const captureFromWebcam = document.getElementById('captureFromWebcam');
const closeWebcam = document.getElementById('closeWebcam');
const previewWrap = document.getElementById('previewWrap');
const previewImage = document.getElementById('previewImage');

// ==========================================
// アプリケーションの状態管理変数
// ==========================================
let geminiApiKey = '';            // config.json に記載がある場合の直接APIキー（空ならVercelプロキシ経由）
let subjects = [];                // 設定ファイルから読み込んだ教科リスト
let apiSettings = {};             // モデル名や温度などのAPIパラメータ
let selectedSubjectId = null;     // 現在選択されている教科のID（例: 'kokugo', 'sansu'）
let selectedImageDataUrl = '';    // 選択・撮影された画像のBase64データURL
let selectedMimeType = 'image/jpeg'; // 画像のMIMEタイプ
let webcamStream = null;          // WebカメラのMediaStreamオブジェクト

/**
 * プロンプト設定値（配列または文字列）を単一の改行区切りテキストに正規化します。
 * @param {string|string[]|any} promptValue - 正規化対象のプロンプトテキストまたは配列
 * @returns {string} トリムされ正規化されたプロンプト文字列
 */
function normalizePromptText(promptValue) {
  if (Array.isArray(promptValue)) {
    return promptValue
      .map((line) => String(line ?? '').trim())
      .filter((line) => line !== '')
      .join('\n');
  }
  if (typeof promptValue === 'string') {
    return promptValue.trim();
  }
  return '';
}

/**
 * 画面上のステータス領域にメッセージとスタイル（成功/エラー）を設定・表示します。
 * @param {string} message - 表示するメッセージテキスト
 * @param {string} [type=''] - クラス名（'success' または 'error'）
 */
function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.classList.remove('error', 'success');
  if (type) {
    statusBox.classList.add(type);
  }
}

/**
 * 選択中の画像データ、プレビュー表示、およびファイル入力をクリアして初期状態に戻します。
 */
function clearSelectedImage() {
  selectedImageDataUrl = '';
  selectedMimeType = 'image/jpeg';
  previewImage.src = '';
  previewWrap.classList.add('hidden');
  imageInput.value = '';
}

/**
 * 教科と画像が両方選択されているか確認し、「採点する」ボタンの活性/非活性を切り替えます。
 */
function updateGradeButtonState() {
  const hasSubject = Boolean(selectedSubjectId);
  const hasImage = Boolean(selectedImageDataUrl);
  // geminiApiKeyが空の場合はVercelの環境変数経由(/api/gemini)で実行可能
  gradeButton.disabled = !(hasSubject && hasImage);
}

/**
 * config.json を取得し、教科設定・APIモデル設定を読み込んでアプリを初期化します。
 * 必須項目（subjects, ocrModel, scoringModel）が不足している場合はエラーで停止します。
 * @throws {Error} 設定ファイルの読み込みやバリデーションに失敗した場合
 */
async function loadConfig() {
  try {
    const response = await fetch('config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('config.json の読み込みに失敗しました。');
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('config.json の内容が不正です。');
    }

    const geminiApiKeyValue = String(data.geminiApiKey || '').trim();
    const nextSubjects = Array.isArray(data.subjects) ? data.subjects : [];
    const nextApiSettings = data.apiSettings && typeof data.apiSettings === 'object' ? data.apiSettings : {};

    if (!nextSubjects.length) {
      throw new Error('config.json に subjects がありません。');
    }

    // モデル設定のハードコードを廃止し、設定ファイル内での明示を必須化
    if (!nextApiSettings.ocrModel || !String(nextApiSettings.ocrModel).trim()) {
      throw new Error('config.json に apiSettings.ocrModel が設定されていません。');
    }
    if (!nextApiSettings.scoringModel || !String(nextApiSettings.scoringModel).trim()) {
      throw new Error('config.json に apiSettings.scoringModel が設定されていません。');
    }

    geminiApiKey = geminiApiKeyValue;
    apiSettings = { ...nextApiSettings };
    subjects = nextSubjects;
    selectedSubjectId = null;

    renderSubjectButtons();
    setStatus('教科を選んで、画像を選択してください。');
  } catch (error) {
    console.error('config.json failed to load.', error);
    geminiApiKey = '';
    apiSettings = {};
    subjects = [];
    selectedSubjectId = null;
    subjectButtons.innerHTML = '';
    setStatus('config.json を読み込めませんでした。設定を修正してアプリを再読み込みしてください。', 'error');
    resultText.textContent = '設定ファイルの読み込みに失敗したため、アプリを停止しました。\n\nconfig.json を確認してください。';
    updateGradeButtonState();
    throw error;
  }

  updateGradeButtonState();
}

/**
 * 教科選択ボタン群を動的に生成し、クリックイベントを設定して画面に描画します。
 */
function renderSubjectButtons() {
  subjectButtons.innerHTML = '';

  subjects.forEach((subject) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'subject-btn';
    button.textContent = subject.label;
    button.dataset.subjectId = subject.id;

    if (selectedSubjectId === subject.id) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => {
      selectedSubjectId = subject.id;
      renderSubjectButtons();
      setStatus(`${subject.label} を選択しました。画像を追加してください。`);
      resultText.textContent = `${subject.label}の採点を開始します。`;
      updateGradeButtonState();
    });

    subjectButtons.appendChild(button);
  });
}

/**
 * ファイル選択（ギャラリーやカメラロール）イベントをハンドリングし、画像をBase64として読み込みます。
 * @param {Event} event - ファイルinputのchangeイベントオブジェクト
 */
function handleImageSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    clearSelectedImage();
    updateGradeButtonState();
    return;
  }

  if (!file.type.startsWith('image/')) {
    clearSelectedImage();
    setStatus('画像ファイルを選択してください。', 'error');
    updateGradeButtonState();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectedImageDataUrl = String(reader.result || '');
    selectedMimeType = file.type || 'image/jpeg';
    previewImage.src = selectedImageDataUrl;
    previewWrap.classList.remove('hidden');
    setStatus(`${file.name} を読み込みました。`, 'success');
    updateGradeButtonState();
  };

  reader.onerror = () => {
    clearSelectedImage();
    setStatus('画像の読み込みに失敗しました。', 'error');
    updateGradeButtonState();
  };

  reader.readAsDataURL(file);
}

/**
 * 起動中のWebカメラのストリームを停止し、リソースを解放します。
 */
function stopWebcamStream() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
  }
  if (cameraPreview) {
    cameraPreview.srcObject = null;
  }
}

/**
 * Webカメラプレビューパネルを閉じ、カメラのストリームを停止します。
 */
function closeWebcamPanel() {
  stopWebcamStream();
  webcamPanel.classList.add('hidden');
}

/**
 * PC等のブラウザでWebカメラを起動し、ビデオプレビューを開始します。
 * カメラが利用できない環境ではギャラリー選択へフォールバックします。
 */
async function startWebcamCapture() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('このブラウザでは Web カメラを利用できません。写真を選択してください。', 'error');
    openGalleryInput();
    return;
  }

  try {
    stopWebcamStream();
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });

    cameraPreview.srcObject = webcamStream;
    webcamPanel.classList.remove('hidden');
    setStatus('Webカメラの映像を確認し、「この画像を採用」を押してください。');
  } catch (error) {
    console.warn('Webcam access failed.', error);
    setStatus('カメラの起動に失敗したため、写真を選択してください。', 'error');
    openGalleryInput();
  }
}

/**
 * ビデオ要素の現在のフレームをCanvasにキャプチャして静止画（Base64 JPEG）に変換します。
 */
function captureFromCameraPreview() {
  if (!cameraPreview || !cameraPreview.videoWidth || !cameraPreview.videoHeight) {
    setStatus('カメラの映像がまだ準備できていません。', 'error');
    return;
  }

  const canvas = document.createElement('canvas');
  const width = cameraPreview.videoWidth;
  const height = cameraPreview.videoHeight;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.drawImage(cameraPreview, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  selectedImageDataUrl = dataUrl;
  selectedMimeType = 'image/jpeg';
  previewImage.src = selectedImageDataUrl;
  previewWrap.classList.remove('hidden');
  closeWebcamPanel();
  setStatus('カメラの写真を取り込みました。', 'success');
  updateGradeButtonState();
}

/**
 * 「カメラで撮る」ボタン押下時の処理。
 * デスクトップ環境ではWebカメラパネルを開き、モバイルではネイティブカメラ呼び出しを行います。
 */
function openCameraInput() {
  if (navigator.userAgent.includes('Windows') || navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Linux')) {
    startWebcamCapture();
    return;
  }

  imageInput.value = '';
  imageInput.click();
}

/**
 * 「写真を選ぶ」ボタン押下時にファイル選択ダイアログを開きます。
 */
function openGalleryInput() {
  galleryInput.value = '';
  galleryInput.click();
}

/**
 * 採点結果表示領域（テキスト）をクリアします。
 */
function clearResultText() {
  resultText.textContent = '';
}

/**
 * 指定されたパスまたはフォールバック候補パスからプロンプト用テキスト（Markdownやテキスト）を非同期取得します。
 * @param {string} promptPath - プロンプトが配置されている基準パス
 * @param {string} [promptType='ocr'] - プロンプト種別（'ocr' または 'scoring'）
 * @returns {Promise<string>} 取得されたプロンプト本文
 */
async function loadPromptText(promptPath, promptType = 'ocr') {
  const safePath = String(promptPath || '').trim();
  if (!safePath) {
    return '';
  }

  const normalizedPath = safePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const candidatePaths = [];

  if (normalizedPath.toLowerCase().endsWith('.md')) {
    candidatePaths.push(normalizedPath);
  } else if (normalizedPath.toLowerCase().endsWith('.txt')) {
    candidatePaths.push(normalizedPath);
  } else {
    candidatePaths.push(
      `${normalizedPath}/${promptType}.md`,
      `${normalizedPath}/${promptType}.txt`,
      `${normalizedPath}/${promptType}-prompt.md`,
      `${normalizedPath}/${promptType}-prompt.txt`,
      `${normalizedPath}/prompt.md`,
      `${normalizedPath}/prompt.txt`,
      `${normalizedPath}/text.md`,
      `${normalizedPath}/text.txt`,
      `${normalizedPath}.md`,
      `${normalizedPath}.txt`
    );
  }

  for (const candidatePath of candidatePaths) {
    try {
      const response = await fetch(candidatePath, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      if (!text || !text.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }

        if (promptType === 'ocr') {
          return normalizePromptText(parsed.ocrPrompt || parsed.prompt || parsed.text || parsed.content) || '';
        }

        if (promptType === 'scoring') {
          return normalizePromptText(parsed.scoringPrompt || parsed.prompt || parsed.text || parsed.content) || '';
        }

        return normalizePromptText(parsed.prompt || parsed.text || parsed.content) || '';
      } catch (error) {
        return text.trim();
      }
    } catch (error) {
      console.warn(`Prompt fetch failed for ${candidatePath}.`, error);
    }
  }

  return '';
}

/**
 * Gemini API に強制する OCR 出力用 JSON スキーマ（Structured Outputs用）を構築します。
 * @returns {object} OCR用JSONスキーマオブジェクト
 */
function buildOcrSchema() {
  return {
    type: 'OBJECT',
    properties: {
      test_title: { type: 'STRING' },
      grade: { type: 'STRING' },
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question_number: { type: 'INTEGER' },
            student_answer: { type: 'STRING' },
            full_text_with_bracket: { type: 'STRING' }
          },
          required: ['question_number', 'student_answer', 'full_text_with_bracket']
        }
      }
    },
    required: ['test_title', 'grade', 'questions']
  };
}

/**
 * Gemini API に強制する 採点出力用 JSON スキーマ（Structured Outputs用）を構築します。
 * @returns {object} 採点用JSONスキーマオブジェクト
 */
function buildScoringSchema() {
  return {
    type: 'OBJECT',
    properties: {
      test_title: { type: 'STRING' },
      grade: { type: 'STRING' },
      correct_count: { type: 'INTEGER' },
      questions_summary: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question_number: { type: 'INTEGER' },
            full_text_with_bracket: { type: 'STRING' },
            student_answer: { type: 'STRING' },
            correct_answer: { type: 'STRING' },
            judgment: { type: 'STRING' },
            reason: { type: 'STRING' }
          },
          required: ['question_number', 'student_answer', 'correct_answer', 'judgment', 'reason']
        }
      }
    },
    required: ['test_title', 'grade', 'correct_count', 'questions_summary']
  };
}

/**
 * 画像付きマルチモーダルリクエスト用の Gemini API ペイロードを組み立てます。
 * @param {string} systemText - プロンプト本文
 * @param {string} imageBase64 - 画像のBase64文字列（プレフィックス除外）
 * @param {string} mimeType - 画像のMIMEタイプ（例: 'image/jpeg'）
 * @param {object|null} [responseSchema=null] - 出力強制用JSONスキーマ
 * @param {number} [temperature=0.0] - 生成の多様性パラメータ
 * @returns {object} APIリクエスト用ペイロードオブジェクト
 */
function buildGeminiPayload(systemText, imageBase64, mimeType, responseSchema = null, temperature = 0.0) {
  const generationConfig = {
    temperature,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json'
  };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  return {
    contents: [
      {
        parts: [
          { text: systemText },
          { inlineData: { mimeType, data: imageBase64 } }
        ]
      }
    ],
    generationConfig
  };
}

/**
 * テキストのみ（画像なし）リクエスト用の Gemini API ペイロードを組み立てます。
 * @param {string} systemText - プロンプト本文
 * @param {object|null} [responseSchema=null] - 出力強制用JSONスキーマ
 * @param {number} [temperature=0.0] - 生成の多様性パラメータ
 * @returns {object} APIリクエスト用ペイロードオブジェクト
 */
function buildGeminiTextPayload(systemText, responseSchema = null, temperature = 0.0) {
  const generationConfig = {
    temperature,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json'
  };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  return {
    contents: [
      {
        parts: [{ text: systemText }]
      }
    ],
    generationConfig
  };
}

/**
 * エラーメッセージがクォータ超過（レートリミット）に該当するか判定します。
 * @param {string} rawMessage - エラーメッセージ文字列
 * @returns {boolean} クォータ超過エラーであれば true
 */
function isQuotaExceededError(rawMessage) {
  const message = String(rawMessage || '').trim();
  return /quota|limit exceeded|free_tier|free tier|rate limit|exceeded your current quota/i.test(message);
}

/**
 * Gemini API の生エラーメッセージをユーザー向けのわかりやすい日本語メッセージに変換します。
 * @param {string} rawMessage - APIから返却されたエラーメッセージ文字列
 * @returns {string} 翻訳・加工後のユーザー向けエラーメッセージ
 */
function translateGeminiError(rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) {
    return 'Gemini APIでエラーが発生しました。しばらくしてからもう一度お試しください。';
  }

  if (isQuotaExceededError(message)) {
    return 'Gemini の無料枠の利用上限に達しました。しばらく待ってから再試行するか、APIキーの有料プランへ切り替えてください。';
  }

  if (/high demand|currently experiencing high demand|capacity|overloaded|429/i.test(message)) {
    return 'Gemini の利用が混雑しています。しばらく待ってからもう一度お試しください。';
  }

  if (/api key|API key|authentication|invalid api|unauthorized/i.test(message)) {
    return 'Gemini APIキーが無効または未設定です。設定を確認してください。';
  }

  if (/model.*not found|not found.*model|does not exist/i.test(message)) {
    return '指定した Gemini モデルが見つかりません。モデル名を確認してください。';
  }

  return 'Gemini APIでエラーが発生しました。\n' + message;
}

/**
 * AIモデルの生テキスト出力から、コードブロック（```json）などを除去して純粋なJSON文字列を切り出します。
 * @param {string} rawText - モデルの生テキスト出力
 * @returns {string} 切り出されたJSON文字列
 */
function extractJsonText(rawText) {
  const text = String(rawText || '').replace(/```json|```/gi, '').trim();
  if (!text) {
    return '{}';
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

/**
 * JSONパースを試み、失敗した場合は軽微な構文不備（末尾カンマやシングルクォート）を自動修復して再パースします。
 * @param {string} rawText - パース対象の文字列
 * @returns {object} パース成功したJavaScriptオブジェクト
 * @throws {Error} 修復後もパースに失敗した場合
 */
function tryParseJsonWithRepair(rawText) {
  const cleaned = extractJsonText(rawText);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const repaired = cleaned
      .replace(/([{,]\s*)([A-Za-z0-9_]+)(\s*:)/g, '$1"$2"$3')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/,\s*([}\]])/g, '$1');

    try {
      return JSON.parse(repaired);
    } catch (repairError) {
      throw error;
    }
  }
}

/**
 * Gemini API を呼び出し、JSONレスポンスをパースして返却します。
 * APIキーの有無に応じて直接呼び出しまたは Vercel サーバーレスプロキシ（/api/gemini）を自動切り替えします。
 * @param {string} modelName - 使用するGeminiモデル名（config.json で指定されたもの）
 * @param {object} payload - APIリクエスト用ペイロード
 * @param {string} apiKey - config.json に指定されたAPIキー（空文字の場合はプロキシ経由）
 * @param {number} [timeoutMs=120000] - タイムアウト時間（ミリ秒）
 * @returns {Promise<object>} パース済みのJSONレスポンスオブジェクト
 * @throws {Error} 通信エラー、APIエラー、またはタイムアウトが発生した場合
 */
async function callGeminiJson(modelName, payload, apiKey, timeoutMs = 120000) {
  const hasDirectKey = Boolean(apiKey && apiKey.trim() && apiKey !== 'PASTE_YOUR_GEMINI_API_KEY_HERE' && apiKey !== 'XXXXXX');
  const apiUrl = hasDirectKey
    ? `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`
    : '/api/gemini';

  const requestBody = hasDirectKey
    ? JSON.stringify(payload)
    : JSON.stringify({ model: modelName, payload });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      let message = 'Gemini API エラー';
      try {
        const parsed = JSON.parse(responseText);
        message = parsed?.error?.message || responseText;
      } catch (error) {
        message = responseText || message;
      }
      throw new Error(translateGeminiError(message));
    }

    let json;
    try {
      json = JSON.parse(responseText);
    } catch (error) {
      throw new Error('Gemini APIからの応答を解析できませんでした。');
    }

    const text = json?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('\n') || '{}';

    return tryParseJsonWithRepair(text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Gemini APIへの接続がタイムアウトしました。モデル名やネットワーク状態を確認してください。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * OCR結果のJSON配列を、採点プロンプトに渡しやすいプレーンテキスト形式に平坦化（フォーマット）します。
 * @param {object} ocrJson - questions配列を含むOCR結果JSON
 * @returns {string} 採点プロンプト用テキスト（問題番号・問題文・生徒解答の並び）
 */
function flattenOcrItems(ocrJson) {
  const questions = Array.isArray(ocrJson?.questions) ? ocrJson.questions : [];
  if (!questions.length) {
    return 'OCR結果: なし';
  }

  const testTitle = ocrJson?.test_title ? String(ocrJson.test_title).trim() : '';
  const grade = ocrJson?.grade ? String(ocrJson.grade).trim() : '';
  const header = [testTitle, grade].filter(Boolean).join(' / ');

  const body = questions.map((item, index) => {
    const questionNumber = Number(item?.question_number ?? index + 1);
    const fullText = item?.full_text_with_bracket ? String(item.full_text_with_bracket).replace(/\s+/g, ' ').trim() : '';
    const studentAnswer = item?.student_answer === undefined || item?.student_answer === null || String(item.student_answer).trim() === ''
      ? '未記入'
      : String(item.student_answer).trim();

    return `問題${questionNumber}:\n問題文: ${fullText || '不明'}\n生徒の解答: ${studentAnswer}`;
  }).join('\n\n');

  return header ? `${header}\n\n${body}` : body;
}

/**
 * 採点AIから返却された生JSONデータを正規化し、正解・不正解リストおよび正確な正解数を集計します。
 * AIが出力した correct_count ではなく、実際の正解リストの要素数から計算して整合性を保証します。
 * @param {object} rawResult - 採点モデルから返却された生JSONデータ
 * @returns {object} 正規化された採点結果オブジェクト（totalQuestions, correctCount, wrongQuestions, correctQuestions）
 */
function normalizeScoringResult(rawResult) {
  const summary = Array.isArray(rawResult?.questions_summary) ? rawResult.questions_summary : [];
  const totalQuestions = summary.length;

  // 不正解の設問を抽出
  const wrongQuestions = summary
    .filter((item) => String(item?.judgment || '').trim() !== '〇')
    .map((item) => ({
      question_number: Number(item?.question_number ?? 0),
      full_text_with_bracket: String(item?.full_text_with_bracket ?? ''),
      student_answer: String(item?.student_answer ?? ''),
      correct_answer: String(item?.correct_answer ?? ''),
      reason: String(item?.reason ?? '')
    }));

  // 正解の設問を抽出
  const correctQuestions = summary
    .filter((item) => String(item?.judgment || '').trim() === '〇')
    .map((item) => ({
      question_number: Number(item?.question_number ?? 0),
      full_text_with_bracket: String(item?.full_text_with_bracket ?? ''),
      student_answer: String(item?.student_answer ?? ''),
      correct_answer: String(item?.correct_answer ?? ''),
      reason: String(item?.reason ?? '')
    }));

  // AIの適当な合計値は使わず、実際に判定された正解数をカウントして整合性を保つ
  const correctCount = correctQuestions.length;

  return {
    test_title: String(rawResult?.test_title ?? ''),
    grade: String(rawResult?.grade ?? ''),
    totalQuestions,
    correctCount,
    wrongQuestions,
    correctQuestions
  };
}

/**
 * 問題文の先頭に付着することがある小問番号表記（例: "(1) " や "（１）"）をクリーンアップします。
 * @param {string} raw - 元のテキスト
 * @returns {string} 先頭の番号を除去したテキスト
 */
function cleanFormula(raw) {
  return String(raw || '').replace(/^\s*[\(（][^)\）]*[\)）]\s*/, '').trim();
}

/**
 * 問題文中の【 】の領域を指定された文字（正解または生徒の解答）で置換し、完全な数式・文章を構築します。
 * @param {string} full_text_with_bracket - 【 】を含む問題文テキスト
 * @param {string} substitution - 置換する文字列（解答値など）
 * @returns {string} 組み立てられた文章または数式
 */
function buildFormula(full_text_with_bracket, substitution) {
  const raw = String(full_text_with_bracket || '');
  if (!raw) return '';
  return cleanFormula(raw.replace(/【[^】]*】/g, String(substitution || '')));
}

/**
 * 採点結果オブジェクトから、画面表示用（不正解優先、正解リスト付き）のフォーマットテキストを生成します。
 * @param {object} finalResult - normalizeScoringResult で正規化されたオブジェクト
 * @returns {string} 画面の pre タグ等に出力する整形済みテキスト
 */
function formatScoringResult(finalResult) {
  const { test_title, grade, totalQuestions, correctCount, wrongQuestions, correctQuestions } = finalResult;
  const lines = [];

  const header = [test_title, grade].filter(Boolean).join(' ');
  if (header) lines.push(header);
  lines.push(`${totalQuestions}問中 ${correctCount}問正解`);

  // 不正解の表示（優先表示）
  lines.push('');
  if (wrongQuestions.length) {
    lines.push('不正解：');
    wrongQuestions.forEach((item) => {
      const qn = item.question_number;
      const student = item.student_answer || '未記入';
      const correct = item.correct_answer;
      const reason = item.reason;
      const formula = buildFormula(item.full_text_with_bracket, student);
      // 式がある場合: （3）640 / 16 = 4 → 40　理由
      // 式がない場合: （3）4 → 40　理由
      lines.push(formula
        ? `（${qn}）${formula} → ${correct}　${reason}`
        : `（${qn}）${student} → ${correct}　${reason}`);
    });
  } else {
    lines.push('不正解はありませんでした。');
  }

  // 正解の表示
  lines.push('');
  lines.push('正解：');
  correctQuestions.forEach((item) => {
    const qn = item.question_number;
    const student = item.student_answer;
    const formula = buildFormula(item.full_text_with_bracket, item.correct_answer);
    // 式がある場合: （1）235 × 4 = 940
    // 式がない場合: （1）県
    lines.push(formula ? `（${qn}）${formula}` : `（${qn}）${student}`);
  });

  return lines.join('\n');
}

/**
 * 採点実行のメイン関数。
 * 1. OCRスキャンを2回並列実行
 * 2. 差分検証プロンプトで結果を突合・確定
 * 3. 確定データを用いて採点を実行し、画面に結果を描画
 */
async function gradeHomework() {
  clearResultText();

  // 入力チェック
  if (!selectedSubjectId || !selectedImageDataUrl) {
    setStatus('教科と画像を選択してください。', 'error');
    return;
  }

  const apiKey = String(geminiApiKey || '').trim();

  const subject = subjects.find((item) => item.id === selectedSubjectId);
  if (!subject) {
    setStatus('選択された教科が見つかりません。', 'error');
    return;
  }

  const temperature = Number(apiSettings.temperature ?? 0.0);
  const ocrModel = String(apiSettings.ocrModel || '').trim();
  const scoringModel = String(apiSettings.scoringModel || '').trim();

  // モデル名のバリデーション
  if (!ocrModel || !scoringModel) {
    setStatus('モデル設定が不正です。config.json を確認してください。', 'error');
    return;
  }
  const imageBase64 = selectedImageDataUrl.includes(',') ? selectedImageDataUrl.split(',')[1] : selectedImageDataUrl;

  gradeButton.disabled = true;

  try {
    const ocrPromptText = normalizePromptText(await loadPromptText(subject.prompt, 'ocr'));
    if (!ocrPromptText) {
      throw new Error(`OCRプロンプトが見つかりません。${subject.prompt}/ocr.md を確認してください。`);
    }

    const ocrSchema = buildOcrSchema();

    // ── ステップ1: OCRスキャンA & Bの並列実行 ──
    setStatus('ステップ1/3: 画像データ読み込み中…');
    const ocrPayloadA = buildGeminiPayload(ocrPromptText, imageBase64, selectedMimeType, ocrSchema, temperature);
    const ocrPayloadB = buildGeminiPayload(ocrPromptText, imageBase64, selectedMimeType, ocrSchema, temperature);

    // Promise.all で2回のOCRを同時に実行し、待ち時間を短縮
    const [ocrJsonA, ocrJsonB] = await Promise.all([
      callGeminiJson(ocrModel, ocrPayloadA, apiKey),
      callGeminiJson(ocrModel, ocrPayloadB, apiKey)
    ]);

    // ── ステップ2: 2つのOCR結果を突合・検証 ──
    setStatus('ステップ2/3: 検証中…');
    const resolveDiffPrompt = normalizePromptText(await loadPromptText('prompts/resolve_diff.md', 'resolve_diff'));

    let finalOcrJson;
    if (resolveDiffPrompt) {
      const diffComparisonPrompt = [
        resolveDiffPrompt,
        '',
        '【スキャンA の結果】',
        JSON.stringify(ocrJsonA, null, 2),
        '',
        '【スキャンB の結果】',
        JSON.stringify(ocrJsonB, null, 2),
        '',
        '上記2つのスキャン結果を比較・精査し、ルールに従って「確定版のOCRデータ」を出力してください。'
      ].join('\n');

      // 比較・統合は画像不要（テキストのみ）
      const diffPayload = buildGeminiTextPayload(diffComparisonPrompt, ocrSchema, temperature);
      finalOcrJson = await callGeminiJson(scoringModel, diffPayload, apiKey);
    } else {
      console.warn('prompts/resolve_diff.md not found, using scan A.');
      finalOcrJson = ocrJsonA;
    }

    const normalizedOcr = finalOcrJson && typeof finalOcrJson === 'object' && Array.isArray(finalOcrJson.questions)
      ? finalOcrJson
      : (ocrJsonA && typeof ocrJsonA === 'object' && Array.isArray(ocrJsonA.questions) ? ocrJsonA : { questions: [] });

    const ocrEvidence = flattenOcrItems(normalizedOcr);
    const scoringBasePrompt = normalizePromptText(await loadPromptText(subject.prompt, 'scoring'));
    if (!scoringBasePrompt) {
      throw new Error(`採点プロンプトが見つかりません。${subject.prompt}/scoring.md を確認してください。`);
    }

    // ── ステップ3: 採点を実行 ──
    setStatus('ステップ3/3: 採点中…');
    const scoringPrompt = [
      scoringBasePrompt,
      '',
      '採点対象の OCR データ:',
      ocrEvidence,
      '',
      '出力はJSONだけにしてください。'
    ].join('\n');

    const scoringPayload = buildGeminiTextPayload(scoringPrompt, buildScoringSchema(), temperature);
    const rawScoring = await callGeminiJson(scoringModel, scoringPayload, apiKey);
    const finalResult = normalizeScoringResult(rawScoring);

    // 採点結果のフォーマットと画面描画
    resultText.textContent = formatScoringResult(finalResult);
    setStatus('採点が完了しました。', 'success');
  } catch (error) {
    console.error(error);
    const displayMessage = error?.message || '採点中にエラーが発生しました。';
    resultText.textContent = '採点中にエラーが発生しました。\n\n' + displayMessage;
    setStatus(displayMessage, 'error');
  } finally {
    updateGradeButtonState();
    gradeButton.disabled = false;
  }
}

/**
 * OCR結果から最大問題番号または問題数を算出します。
 * @param {object} ocrJson - questions配列を含むOCR結果JSON
 * @returns {number} 検出された問題数
 */
function getQuestionCount(ocrJson) {
  const questions = Array.isArray(ocrJson?.questions) ? ocrJson.questions : [];
  if (!questions.length) {
    return 0;
  }

  const maxNumber = questions.reduce((max, item) => {
    const value = Number(item?.question_number ?? 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);

  return maxNumber > 0 ? maxNumber : questions.length;
}

// ==========================================
// イベントリスナーの登録とアプリ初期化
// ==========================================
imageInput.addEventListener('change', handleImageSelection);
galleryInput.addEventListener('change', handleImageSelection);
cameraButton.addEventListener('click', openCameraInput);
galleryButton.addEventListener('click', openGalleryInput);
captureFromWebcam.addEventListener('click', captureFromCameraPreview);
closeWebcam.addEventListener('click', closeWebcamPanel);
gradeButton.addEventListener('click', gradeHomework);

// 初期化実行
subjectButtons.innerHTML = '';
setStatus('config.json を読み込み中です…');
updateGradeButtonState();
loadConfig();
