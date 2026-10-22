/* ==================== 常量 ==================== */
const STORAGE_KEY = 'fde-quiz-progress-v1';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TYPE_LABEL = { single: '单选', multiple: '多选', judge: '判断' };

/* ==================== 状态 ==================== */
const state = {
    questions: [],           // 完整题库
    mode: 'all',             // 'all' | 'wrong'
    index: 0,                // 当前模式列表中的索引
    userAnswers: {},         // { qid: [选项索引] }
    submitted: {},           // { qid: true } 答对过即锁定
    wrongIds: new Set(),     // 答错且尚未答对的题
    wrongDisplayIds: new Set(), // 已展示过错误反馈的题
    correctCounts: {},       // { qid: 累计答对次数 } —— 用于“答对3次是否移出错题集”
    filterTag: null,         // 错题集按标签筛选
    bankSig: '',             // 题库指纹（用于校验本地进度是否属于同一题库）
    bankName: '',
    pool: null,              // 随机组卷：有序的题目 id 数组；null 表示全题库
    qmap: {},                // id -> 题目对象
};

/* ==================== DOM ==================== */
const $ = (id) => document.getElementById(id);
const uploadArea = $('uploadArea');
const uploadBtn = $('uploadBtn');
const fileInput = $('fileInput');
const fileNameDisplay = $('fileNameDisplay');
const backToQuizBtn = $('backToQuizBtn');
const quizPanel = $('quizPanel');
const totalCount = $('totalCount');
const correctCountEl = $('correctCount');
const rateDisplay = $('rateDisplay');
const wrongBadge = $('wrongBadge');
const wrongCountEl = $('wrongCount');
const toggleWrongBtn = $('toggleWrongBtn');
const switchBankBtn = $('switchBankBtn');
const resetBtn = $('resetBtn');
const saveHint = $('saveHint');
const randomBtn = $('randomBtn');
const removeWrongBtn = $('removeWrongBtn');
const exitPoolBtn = $('exitPoolBtn');
const qNumber = $('qNumber');
const qTag = $('qTag');
const qType = $('qType');
const qText = $('qText');
const optionsContainer = $('optionsContainer');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const progressHint = $('progressHint');
const finishScreen = $('finishScreen');
const finishSummary = $('finishSummary');
const finishResetBtn = $('finishResetBtn');
const finishWrongBtn = $('finishWrongBtn');
const feedbackArea = $('feedbackArea');
const feedbackCorrect = $('feedbackCorrect');
const feedbackExplanation = $('feedbackExplanation');
const wrongStats = $('wrongStats');
const wrongSub = $('wrongSub');
const wrongBars = $('wrongBars');
const wrongHint = $('wrongHint');
const toastEl = $('toast');

/* ==================== 小工具 ==================== */
const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let toastTimer = null;
function toast(msg) {
    if (!toastEl) return;
    toastEl.innerHTML = '<span class="pill">' + esc(msg) + '</span>';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function flashSaved() {
    if (!saveHint) return;
    saveHint.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => saveHint.classList.remove('show'), 1200);
}

/* ==================== 派生统计 ==================== */
/** 当前题池（全题库 或 随机组卷的子集，保持抽取顺序） */
function baseList() {
    if (!state.pool) return state.questions;
    return state.pool.map((id) => state.qmap[id]).filter(Boolean);
}

function masteredCount() {
    // 仍在错题集里的题不算“已掌握”（需手动/确认移除后才算）
    return baseList().filter((q) => state.submitted[q.id] && !state.wrongIds.has(q.id)).length;
}
function wrongTotal() {
    return baseList().filter((q) => state.wrongIds.has(q.id)).length;
}
function resolvedCount() {
    return baseList().filter((q) => state.submitted[q.id] || state.wrongIds.has(q.id)).length;
}
function allResolved() {
    const base = baseList();
    return base.length > 0 && resolvedCount() >= base.length;
}

/** 清空本轮答题记录（保留题库与题池） */
function resetSession() {
    state.userAnswers = {};
    state.submitted = {};
    state.wrongIds = new Set();
    state.wrongDisplayIds = new Set();
    state.correctCounts = {};
    state.mode = 'all';
    state.index = 0;
    state.filterTag = null;
}

/* ==================== 列表 ==================== */
function getCurrentList() {
    const base = baseList();
    if (state.mode === 'all') return base;
    let list = base.filter((q) => state.wrongIds.has(q.id));
    if (state.filterTag) {
        list = list.filter((q) => (q.tag || '未标注') === state.filterTag);
    }
    return list;
}

function getCurrentQuestion() {
    const list = getCurrentList();
    if (list.length === 0) return null;
    return list[state.index] || null;
}

/* ==================== 判题 ==================== */
function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const sa = [...a].sort(), sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

function checkAnswer(q, selected) {
    if (!selected || selected.length === 0) return false;
    const type = q.type || 'single';
    if (type === 'single' || type === 'judge') {
        return selected.length === 1 && selected[0] === q.answer;
    }
    if (type === 'multiple') return arraysEqual(selected, q.answer);
    return false;
}

function getCorrectAnswerText(q) {
    const type = q.type || 'single';
    const label = (i) => (LETTERS[i] || i) + '. ' + q.options[i];
    if (type === 'multiple') return q.answer.map(label).join('；');
    return label(q.answer);
}

/* ==================== 本地持久化 ==================== */
function saveProgress() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            v: 1,
            bankSig: state.bankSig,
            index: state.index,
            mode: state.mode,
            filterTag: state.filterTag,
            pool: state.pool,
            userAnswers: state.userAnswers,
            submitted: state.submitted,
            wrongIds: [...state.wrongIds],
            wrongDisplayIds: [...state.wrongDisplayIds],
            correctCounts: state.correctCounts,
        }));
        flashSaved();
    } catch (e) { /* 隐私模式或配额不足，静默降级 */ }
}

function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}

function restoreProgress() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
    if (!raw) return false;

    let d = null;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || d.bankSig !== state.bankSig) return false;   // 换题库则丢弃旧进度

    const ids = new Set(state.questions.map((q) => q.id));
    state.userAnswers = {};
    Object.entries(d.userAnswers || {}).forEach(([k, v]) => {
        if (ids.has(Number(k)) && Array.isArray(v)) state.userAnswers[k] = v;
    });
    state.submitted = {};
    Object.entries(d.submitted || {}).forEach(([k, v]) => {
        if (ids.has(Number(k)) && v === true) state.submitted[k] = true;
    });
    state.wrongIds = new Set((d.wrongIds || []).filter((id) => ids.has(id)));
    state.wrongDisplayIds = new Set((d.wrongDisplayIds || []).filter((id) => ids.has(id)));
    state.correctCounts = {};
    Object.entries(d.correctCounts || {}).forEach(([k, v]) => {
        if (ids.has(Number(k)) && Number.isFinite(+v)) state.correctCounts[k] = +v;
    });

    state.filterTag = d.filterTag || null;
    const poolIds = Array.isArray(d.pool) ? d.pool.filter((id) => ids.has(id)) : null;
    state.pool = (poolIds && poolIds.length) ? poolIds : null;
    state.mode = (d.mode === 'wrong' && state.wrongIds.size > 0) ? 'wrong' : 'all';

    const len = getCurrentList().length;
    state.index = Math.min(Math.max(0, Number(d.index) || 0), Math.max(0, len - 1));
    return true;
}

/* ==================== 渲染 ==================== */
function renderQuestion() {
    const q = getCurrentQuestion();

    if (!q) {
        qNumber.textContent = '无题目';
        qType.textContent = '';
        qTag.classList.add('hidden');
        if (state.mode === 'wrong') {
            qText.textContent = state.filterTag
                ? `该标签下没有错题（${state.filterTag}）`
                : '错题集是空的，恭喜！';
        } else {
            qText.textContent = '请上传题库';
        }
        optionsContainer.innerHTML = '';
        feedbackArea.classList.add('hidden');
        progressHint.textContent = '—';
        updateNavButtons();
        updateStats();
        renderWrongStats();
        return;
    }

    const list = getCurrentList();
    const idx = state.index + 1;
    const total = list.length;

    qNumber.textContent = `第 ${idx} 题（共 ${total} 题）`;
    qType.textContent = TYPE_LABEL[q.type] || '单选';

    if (q.tag) {
        qTag.textContent = q.tag;
        qTag.classList.remove('hidden');
    } else {
        qTag.classList.add('hidden');
    }

    qText.textContent = q.question;

    const selected = state.userAnswers[q.id] || [];
    const inWrong = state.wrongIds.has(q.id);
    // 错题集里的题保持“可重做”，否则永远累计不到 3 次
    const isSubmitted = (state.submitted[q.id] || false) && !inWrong;
    const showFeedback = state.wrongDisplayIds.has(q.id) && !isSubmitted;

    let html = '';
    q.options.forEach((optText, optIdx) => {
        const checked = selected.includes(optIdx);
        const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
        const isCorrectAnswer = q.type === 'multiple'
            ? q.answer.includes(optIdx)
            : q.answer === optIdx;

        let classes = 'option-item';
        if (isSubmitted) {
            classes += ' disabled correct';
        } else if (showFeedback) {
            if (checked && !isCorrectAnswer) classes += ' wrong';
            else if (isCorrectAnswer) classes += ' reveal-correct';
            else if (checked) classes += ' selected';
        } else if (checked) {
            classes += ' selected';
        }

        html += `
            <div class="${classes}" data-opt-index="${optIdx}">
                <input type="${inputType}" name="q_${q.id}" value="${optIdx}"
                       ${checked ? 'checked' : ''} ${isSubmitted ? 'disabled' : ''} />
                <span class="label">${LETTERS[optIdx] || optIdx}</span>
                <span class="text">${esc(optText)}</span>
            </div>`;
    });
    optionsContainer.innerHTML = html;

    removeWrongBtn.classList.toggle('hidden', !state.wrongIds.has(q.id));

    if (showFeedback) {
        feedbackArea.classList.remove('hidden');
        feedbackCorrect.textContent = '正确答案：' + getCorrectAnswerText(q);
        feedbackExplanation.textContent = '📖 ' + (q.explanation || '（本题无解析）');
    } else {
        feedbackArea.classList.add('hidden');
    }

    progressHint.textContent = `第 ${idx} / ${total} 题` +
        (state.pool ? `（随机组卷 ${state.pool.length} 题）` : '') +
        (state.mode === 'wrong' ? '（错题集）' : '') +
        (state.filterTag ? ` · 标签：${state.filterTag}` : '');

    updateNavButtons();
    updateStats();
    renderWrongStats();
    checkFinish();
}

function updateStats() {
    const total = baseList().length;
    const mastered = masteredCount();
    const wrong = wrongTotal();

    totalCount.textContent = total;
    correctCountEl.textContent = mastered;
    const rate = total === 0 ? 0 : Math.round((mastered / total) * 100);
    rateDisplay.textContent = rate + '%';

    if (wrong > 0) {
        wrongBadge.classList.remove('hidden');
        wrongCountEl.textContent = wrong;
        toggleWrongBtn.classList.remove('hidden');
        toggleWrongBtn.textContent = state.mode === 'wrong'
            ? `📚 全部题目 (${total})`
            : `📕 错题集 (${wrong})`;
    } else {
        wrongBadge.classList.add('hidden');
        toggleWrongBtn.classList.add('hidden');
    }

    switchBankBtn.classList.toggle('hidden', !state.bankName);
    exitPoolBtn.classList.toggle('hidden', !state.pool);
}

/* ---- 关键修复：按钮不再因“已在最后一题”而禁用 ---- */
function updateNavButtons() {
    const list = getCurrentList();
    const total = list.length;
    const q = getCurrentQuestion();

    prevBtn.disabled = state.index <= 0;
    nextBtn.disabled = total === 0;          // 仅当没有题目时禁用

    const isLast = state.index >= total - 1;
    if (!isLast) {
        nextBtn.textContent = '下一题 ▶';
    } else if (q && state.submitted[q.id]) {
        nextBtn.textContent = '✔ 已完成';
    } else {
        nextBtn.textContent = '✔ 提交本题';
    }
}

/* ==================== 错题统计（按标签） ==================== */
function renderWrongStats() {
    if (state.mode !== 'wrong') {
        wrongStats.classList.add('hidden');
        return;
    }
    wrongStats.classList.remove('hidden');

    const wrongList = state.questions.filter((q) => state.wrongIds.has(q.id));
    const byTag = new Map();
    wrongList.forEach((q) => {
        const t = q.tag || '未标注';
        byTag.set(t, (byTag.get(t) || 0) + 1);
    });

    const entries = [...byTag.entries()].sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 1;

    wrongSub.textContent = `共 ${wrongList.length} 题 · ${entries.length} 个标签` +
        ` · 已掌握 ${masteredCount()}/${state.questions.length}`;

    let html = '';
    if (state.filterTag) {
        html += `<button class="ws-row ws-clear" data-tag="">
                    <span class="ws-name">✕ 取消筛选</span>
                    <span class="ws-bar"></span>
                    <span class="ws-num">全部</span>
                 </button>`;
    }
    entries.forEach(([tag, n]) => {
        const pct = Math.round((n / max) * 100);
        const active = state.filterTag === tag ? ' active' : '';
        html += `<button class="ws-row${active}" data-tag="${esc(tag)}">
                    <span class="ws-name">${esc(tag)}</span>
                    <span class="ws-bar"><i style="width:${pct}%"></i></span>
                    <span class="ws-num">${n}</span>
                 </button>`;
    });
    wrongBars.innerHTML = html || '<div class="ws-empty">暂无错题</div>';

    wrongHint.textContent = entries.length
        ? '点标签可只看该考点的错题，再点一次取消'
        : '';
}

/* ==================== 完成 ==================== */
function checkFinish() {
    if (state.mode === 'all' && allResolved()) showFinish();
    else hideFinish();
}

function showFinish() {
    const total = baseList().length;
    const mastered = masteredCount();
    const wrong = wrongTotal();
    const rate = total === 0 ? 0 : Math.round((mastered / total) * 100);

    finishSummary.innerHTML =
        `掌握 <strong>${mastered}</strong> / ${total} 题，掌握率 <strong>${rate}%</strong>` +
        (wrong > 0
            ? `<br><span class="finish-wrong">错题集还剩 ${wrong} 题（答对满 3 次会询问是否移出，也可手动移除）</span>`
            : '');

    finishScreen.classList.remove('hidden');
    $('questionCard').style.display = 'none';
    document.querySelector('.action-row').style.display = 'none';
    progressHint.style.display = 'none';
    wrongStats.classList.add('hidden');

    if (wrong > 0) {
        finishWrongBtn.classList.remove('hidden');
        finishWrongBtn.textContent = `📕 练习错题 (${wrong})`;
    } else {
        finishWrongBtn.classList.add('hidden');
    }
}

function hideFinish() {
    finishScreen.classList.add('hidden');
    $('questionCard').style.display = 'block';
    document.querySelector('.action-row').style.display = 'flex';
    progressHint.style.display = 'block';
}

/* ==================== 核心操作 ==================== */
function handleNext() {
    const q = getCurrentQuestion();
    if (!q) return;

    // 已掌握（答对过且不在错题集）-> 往后走；错题集里的题允许重做
    if (state.submitted[q.id] && !state.wrongIds.has(q.id)) { advance(); return; }

    const selected = state.userAnswers[q.id] || [];
    if (selected.length === 0) { toast('请先选择答案'); return; }

    if (checkAnswer(q, selected)) {
        state.submitted[q.id] = true;
        state.wrongDisplayIds.delete(q.id);
        delete state.userAnswers[q.id];          // 清掉本次选择，错题集里的题下次可重做
        state.correctCounts[q.id] = (state.correctCounts[q.id] || 0) + 1;
        const times = state.correctCounts[q.id];

        // 错题集不再自动移除：累计答对满 3 次（3/6/9…）时询问一次，点确定才移除
        if (state.wrongIds.has(q.id) && times % 3 === 0) {
            saveProgress();
            const ok = confirm(
                `本题已累计答对 ${times} 次。\n是否从错题集中移除？\n\n` +
                `· 点「确定」移除\n· 点「取消」保留（之后每答对满 3 次会再询问）`
            );
            if (ok) {
                state.wrongIds.delete(q.id);
                toast('已移出错题集');
            }
            saveProgress();
            advance();
            return;
        }

        saveProgress();
        advance();
        return;
    }

    // 答错
    state.wrongIds.add(q.id);
    if (!state.wrongDisplayIds.has(q.id)) {
        state.wrongDisplayIds.add(q.id);
        saveProgress();
        renderQuestion();
        toast('答错了，看下反馈；再点一次可继续');
        return;
    }
    saveProgress();
    advance();
}

function advance() {
    const list = getCurrentList();
    if (state.index < list.length - 1) {
        state.index++;
        saveProgress();
        renderQuestion();
        return;
    }

    // 已在最后一题：若还有未掌握题，留在原地并提示（不再静默卡住）
    const left = baseList().length - resolvedCount();
    saveProgress();
    renderQuestion();
    if (left > 0) {
        toast(`已完成本轮，还有 ${left} 题未掌握，可点「上一题」或切到错题集`);
    }
}

function handlePrev() {
    if (state.index > 0) {
        state.index--;
        saveProgress();
        renderQuestion();
    }
}

function toggleMode() {
    if (state.mode === 'all') {
        if (state.wrongIds.size === 0) { toast('当前没有错题'); return; }
        state.mode = 'wrong';
    } else {
        state.mode = 'all';
    }
    state.index = 0;
    state.filterTag = null;
    saveProgress();
    renderQuestion();
}

function setTagFilter(tag) {
    if (!tag) {
        state.filterTag = null;
    } else {
        state.filterTag = state.filterTag === tag ? null : tag;
    }
    state.index = 0;
    saveProgress();
    renderQuestion();
}

/* ==================== 随机组卷 ==================== */
function startRandomQuiz() {
    const total = state.questions.length;
    if (total === 0) { toast('请先加载题库'); return; }

    const raw = prompt(`请输入随机组卷的题目数量（1-${total}）：`, String(Math.min(50, total)));
    if (raw === null) return;

    const num = parseInt(raw, 10);
    if (!Number.isFinite(num) || num < 1 || num > total) {
        alert(`请输入 1 到 ${total} 之间的数字`);
        return;
    }
    if (!confirm(`随机抽取 ${num} 道题开始练习？\n当前这轮的答题进度会被重置（题库本身不受影响）。`)) return;

    const ids = state.questions.map((q) => q.id);
    for (let i = ids.length - 1; i > 0; i--) {          // Fisher-Yates
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    state.pool = ids.slice(0, num);
    resetSession();
    hideFinish();
    saveProgress();
    renderQuestion();
    toast(`已随机抽取 ${num} 题，开始吧`);
}

/** 手动把当前题移出错题集 */
function removeCurrentFromWrong() {
    const q = getCurrentQuestion();
    if (!q || !state.wrongIds.has(q.id)) return;
    if (!confirm('从错题集中移除本题？\n（移除后不会再出现在错题集）')) return;
    state.wrongIds.delete(q.id);
    state.wrongDisplayIds.delete(q.id);
    saveProgress();
    renderQuestion();
    toast('已移出错题集');
}

function exitPool() {
    if (!state.pool) return;
    if (!confirm('回到全题库？当前这轮的答题进度会被重置。')) return;
    state.pool = null;
    resetSession();
    hideFinish();
    saveProgress();
    renderQuestion();
    toast('已回到全题库');
}

/* ==================== 重置 ==================== */
function resetProgress() {
    if (!confirm('重置将清除所有答题进度（题库保留），确定继续吗？')) return;
    state.userAnswers = {};
    state.submitted = {};
    state.wrongIds = new Set();
    state.wrongDisplayIds = new Set();
    state.mode = 'all';
    state.index = 0;
    state.filterTag = null;
    saveProgress();
    hideFinish();
    renderQuestion();
    toast('已重置进度');
}

/* ==================== 题库加载 ==================== */
function normalizeBank(list) {
    return list.map((q, i) => ({
        id: Number.isFinite(+q.id) ? +q.id : i + 1,
        type: q.type || 'single',
        tag: q.tag || '',
        tagCode: q.tagCode || '',
        question: String(q.question || ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        answer: q.answer,
        explanation: q.explanation || '',
    }));
}

function validateBank(list) {
    if (!Array.isArray(list) || list.length === 0) return '题库必须是非空数组';
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (!q.question) return `第 ${i + 1} 题缺少 question`;
        if (!Array.isArray(q.options) || q.options.length < 2) return `第 ${i + 1} 题 options 少于 2 个`;
        if (q.answer === undefined) return `第 ${i + 1} 题缺少 answer`;
        if (q.type === 'multiple') {
            if (!Array.isArray(q.answer)) return `第 ${i + 1} 题（多选）answer 必须是数组`;
            for (const a of q.answer) {
                if (a < 0 || a >= q.options.length) return `第 ${i + 1} 题答案索引越界`;
            }
        } else {
            if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) {
                return `第 ${i + 1} 题答案索引无效`;
            }
        }
    }
    return null;
}

function bankSignature(list) {
    const first = list[0] ? list[0].id : '';
    const last = list[list.length - 1] ? list[list.length - 1].id : '';
    return `${list.length}|${first}|${last}`;
}

function loadBank(list, name, opts) {
    opts = opts || {};
    const err = validateBank(list);
    if (err) { alert('题库格式错误：' + err); return false; }

    state.questions = normalizeBank(list);
    state.qmap = {};
    state.questions.forEach((q) => { state.qmap[q.id] = q; });
    state.pool = null;
    state.bankSig = bankSignature(state.questions);
    state.bankName = name || '题库';
    state.userAnswers = {};
    state.submitted = {};
    state.wrongIds = new Set();
    state.wrongDisplayIds = new Set();
    state.mode = 'all';
    state.index = 0;
    state.filterTag = null;

    const restored = opts.restore === false ? false : restoreProgress();

    uploadArea.classList.add('hidden');
    quizPanel.style.display = 'block';
    hideFinish();
    renderQuestion();

    if (restored) {
        toast(`已恢复上次进度：第 ${state.index + 1} 题，掌握 ${masteredCount()}/${state.questions.length}`);
    }
    return true;
}

/* ==================== 上传 ==================== */
function showUpload() {
    uploadArea.classList.remove('hidden');
    quizPanel.style.display = 'none';
    backToQuizBtn.classList.toggle('hidden', state.questions.length === 0);
}

function backToQuiz() {
    if (state.questions.length === 0) return;
    uploadArea.classList.add('hidden');
    quizPanel.style.display = 'block';
    renderQuestion();
}

function loadFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        let data;
        try {
            data = JSON.parse(e.target.result);
        } catch (err) {
            alert('文件解析失败：' + err.message);
            return;
        }
        if (loadBank(data, file.name)) {
            fileNameDisplay.textContent = `📄 ${file.name}`;
            fileNameDisplay.classList.remove('hidden');
        }
    };
    reader.readAsText(file);
}

uploadBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener('change', function () {
    if (this.files && this.files.length > 0) loadFile(this.files[0]);
    this.value = '';
});

uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    this.style.borderColor = '#4a6cf7';
    this.style.background = '#f0f4ff';
});
uploadArea.addEventListener('dragleave', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d0d7e2';
    this.style.background = '#fafbfc';
});
uploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    this.style.borderColor = '#d0d7e2';
    this.style.background = '#fafbfc';
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const f = files[0];
    if (f.type === 'application/json' || f.name.endsWith('.json')) loadFile(f);
    else alert('请上传 JSON 文件');
});

/* ==================== 事件绑定 ==================== */
optionsContainer.addEventListener('click', function (e) {
    const target = e.target.closest('.option-item');
    if (!target) return;
    const q = getCurrentQuestion();
    if (!q) return;

    if (state.submitted[q.id] && !state.wrongIds.has(q.id)) {
        toast('本题已掌握，答案已锁定');
        return;
    }
    const optIndex = parseInt(target.dataset.optIndex, 10);
    let selected = state.userAnswers[q.id] || [];

    if (q.type === 'multiple') {
        const i = selected.indexOf(optIndex);
        if (i > -1) selected.splice(i, 1);
        else selected.push(optIndex);
        state.userAnswers[q.id] = selected;
    } else {
        state.userAnswers[q.id] = [optIndex];
    }
    saveProgress();
    renderQuestion();
});

wrongBars.addEventListener('click', function (e) {
    const row = e.target.closest('.ws-row');
    if (!row) return;
    setTagFilter(row.dataset.tag || '');
});

nextBtn.addEventListener('click', handleNext);
prevBtn.addEventListener('click', handlePrev);
toggleWrongBtn.addEventListener('click', toggleMode);
resetBtn.addEventListener('click', resetProgress);
finishResetBtn.addEventListener('click', resetProgress);
switchBankBtn.addEventListener('click', showUpload);
randomBtn.addEventListener('click', startRandomQuiz);
removeWrongBtn.addEventListener('click', removeCurrentFromWrong);
exitPoolBtn.addEventListener('click', exitPool);
backToQuizBtn.addEventListener('click', backToQuiz);

finishWrongBtn.addEventListener('click', function () {
    if (state.wrongIds.size === 0) { toast('没有错题'); return; }
    state.mode = 'wrong';
    state.index = 0;
    state.filterTag = null;
    saveProgress();
    hideFinish();
    renderQuestion();
});

/* ==================== 键盘快捷键 ==================== */
document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

    if (e.key === 'ArrowLeft' && !prevBtn.disabled) {
        handlePrev(); e.preventDefault();
    } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && !nextBtn.disabled) {
        handleNext(); e.preventDefault();
    }
});

/* ==================== 初始化 ==================== */
(function boot() {
    finishScreen.classList.add('hidden');
    quizPanel.style.display = 'none';

    if (Array.isArray(window.FDE_QUESTIONS) && window.FDE_QUESTIONS.length) {
        loadBank(window.FDE_QUESTIONS, '内置题库（FDE 200 题）');
        console.log('📝 已加载内置题库：' + state.questions.length + ' 题');
    } else {
        showUpload();
        console.log('📝 未找到内置题库，请上传 questions.json');
    }
})();
