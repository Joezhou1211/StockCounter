// ===== 盘点模式脚本 =====
let rawRows = [];              // 上传文件解析出的原始数据（对象数组）
let dateRanges = [];           // {label,start,end,hidden}
let inventoryTable = null;     // DataTable 实例
let html5QrCode = null;        // 扫描器实例
let scanning = false; 
let ocrStream = null;
let ocrInterval = null;
let currentCode = null;
let ocrWorker = null; 
let ocrWorkerReady  = null; 
let scanningFlag = false;
let flashlightEnabled = false; // 手电筒状态
let currentZoom = 1;           // 全局变焦倍数

function updatePlaceholders(){
    $('#codeSearch').attr('placeholder', t('搜索 Code ...','Search Code ...'));
    if($('#scrollHint').length){
        $('#scrollHint').html('<span class="lang-en">← Swipe for more columns →</span>');
    }
}

// ------------ 文件上传与表格初始化 ------------
$(document).ready(function(){
    updatePlaceholders();
    document.body.addEventListener('langChanged', updatePlaceholders);
    // 处理文件上传
    $('#fileUpload').on('change', function(e){
        const file = e.target.files[0];
        if(!file){return;}
        const reader = new FileReader();
        reader.onload = function(evt){
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, {header: 1});
            parseSheet(json);
            showToast(t('文件读取成功','File read successfully'));
        };
        reader.readAsArrayBuffer(file);
    });

    // 添加日期范围
    $('#addDateRangeBtn').on('click', function(){
        const s = $('#startDate').val();
        const e = $('#endDate').val();
        if(!s && !e){
            alert(t('请至少设置开始或结束日期','Please set start or end date'));
            return;
        }
        const start = s ? new Date(s) : null;
        const end   = e ? new Date(e) : null;
        if(start && end && start > end){
            alert(t('开始日期不能晚于结束日期','Start date cannot be after end date'));
            return;
        }
        // 检查重叠
        if(isOverlap(start,end)){
            alert(t('日期范围与现有范围重叠','Range overlaps existing one'));
            return;
        }
        const label = buildLabel(start,end);
        dateRanges.push({label,start,end,hidden:false});
        renderDateRangeList();
        $('#startDate').val('');
        $('#endDate').val('');
    });

    // 完成配置
    $('#finishSetupBtn').on('click', function(){
        if(rawRows.length === 0){
            alert(t('请先上传商品清单','Please upload product list first'));
            return;
        }
        if(dateRanges.length === 0){
            alert(t('请至少添加一个日期范围','Please add at least one date range'));
            return;
        }
        // 构建表头
        buildTable();
        // 切换界面
        $('#setupSection').addClass('d-none');
        $('#tableSection').removeClass('d-none');
        $('#actionButtons').removeClass('d-none');

        // 调整列宽，保证表头与数据对齐
        if(inventoryTable){
            inventoryTable.columns.adjust().draw(false);
        }

        // 显示左右滑动提示（3秒后自动消失，仅首次创建）
        if(!$('#scrollHint').length){
            const hint=$('<div id="scrollHint" class="scroll-hint" style="bottom:30%!important;"></div>');
            $('#tableSection').css('position','relative').append(hint);
            updatePlaceholders();
            setTimeout(()=>hint.fadeOut(800,()=>hint.remove()), 4000);
        }
    });

    // 底部按钮事件
    $('#scanBtn').on('click', openScanner);
    $('#closeScanner').on('click', closeScannerModal);
    $('#exportBtn').on('click', exportTable);

    // 新增：条码确认弹窗的按钮事件
    $('#confirmBarcodeBtn').on('click', function(){
        const code = $('#barcodeConfirmInput').val().trim();
        if (!code) {
            showToast(t('条码不能为空','Barcode cannot be empty'));
            return;
        }
        updateCountForCode(code);
        currentCode = code;

        // 隐藏确认框，关闭扫描器，打开OCR
        $('#barcodeConfirmContainer').addClass('d-none');
        closeScannerModal(); // 这会停止摄像头
        openOcrModal();
    });

    $('#cancelBarcodeBtn').on('click', function(){
        $('#barcodeConfirmContainer').addClass('d-none');
        if(html5QrCode) {
            try {
                html5QrCode.resume();
            } catch (e) {
                console.error("恢复扫描失败", e);
                // 如果恢复失败，可能需要重启扫描
                closeScannerModal();
            }
        }
    });

    // 关闭 OCR 模态按钮
    $('#closeOcr').on('click', function(){
        const msg = currentCode
            ? t(`当前商品 ${currentCode} 已添加，日期将会留空。确认关闭？`,`Item ${currentCode} added without date. Close?`)
            : t('确认关闭日期识别？','Close date recognition?');
        if(confirm(msg)){
            closeOcrModal();
        }
    });

    // 刷新 / 关闭提示
    window.onbeforeunload = function(){
        return t('确定要刷新或关闭吗？未保存的数据可能会丢失。','Leave page? Unsaved data may be lost.');
    };

    // 手电筒开关
    function updateFlashBtnUI(){
        if(flashlightEnabled){
            $('#flashToggle').removeClass('btn-danger').addClass('btn-success').find('span').text(t('开','On'));
            $('#flashToggleDuringScan').removeClass('btn-danger').addClass('btn-success');
            $('#flashToggleInOcr').removeClass('btn-danger').addClass('btn-success');
        }else{
            $('#flashToggle').removeClass('btn-success').addClass('btn-danger').find('span').text(t('关','Off'));
            $('#flashToggleDuringScan').removeClass('btn-success').addClass('btn-danger');
            $('#flashToggleInOcr').removeClass('btn-success').addClass('btn-danger');
        }
    }

    $('#flashToggle').on('click',function(){
        flashlightEnabled = !flashlightEnabled;
        updateFlashBtnUI();
    });

    $('#flashToggleDuringScan, #flashToggleInOcr').on('click',function(){
        flashlightEnabled = !flashlightEnabled;
        applyTorchState();
        updateFlashBtnUI();
    });

    // Zoom button events
    function updateZoomButtons(){
        $('.zoom-btn').removeClass('btn-primary').addClass('btn-light');
        $(`.zoom-btn[data-zoom="${currentZoom}"]`).removeClass('btn-light').addClass('btn-primary');
    }

    $('.zoom-btn').on('click',function(){
        currentZoom = parseFloat($(this).data('zoom'));
        updateZoomButtons();
        applyZoomToActiveCamera();
    });

    updateZoomButtons();

    // 初始化按钮状态
    updateFlashBtnUI();
});

function parseSheet(rows){
    if(rows.length === 0){return;}
    const header = rows[0];
    const colIndex = {code:-1,name:-1,count:-1};
    header.forEach((h,idx)=>{
        const key = (h||'').toString().toLowerCase();
        if(['code'].includes(key)){colIndex.code=idx;}
        if(['product name','name','product','products'].includes(key)){colIndex.name=idx;}
        if(['count'].includes(key)){colIndex.count=idx;}
    });
    if(colIndex.code === -1){
        alert(t('未检测到 Code 列','Code column not found'));
        return;
    }
    // 解析行
    rawRows = rows.slice(1).map(r=>{
        return {
            code: (r[colIndex.code]||'').toString().trim(),
            name: colIndex.name!==-1 ? (r[colIndex.name]||'').toString().trim() : '',
            count: colIndex.count!==-1 ? parseInt(r[colIndex.count]||0) : 0
        };
    }).filter(r=>r.code);
}

function buildLabel(start,end){
    // 返回带 <br> 的多行 HTML 以便表头上下居中显示
    if(start && end){
        return `<span>${formatDate(start)}</span><br><span class="text-muted small">To</span><br><span>${formatDate(end)}</span>`;
    }else if(!start && end){
        return `<span>Before</span><br><span>${formatDate(end)}</span>`;
    }else if(start && !end){
        return `<span>After</span><br><span>${formatDate(start)}</span>`;
    }
    return 'Unknown';
}

function renderDateRangeList(){
    const container = $('#dateRangeList');
    container.empty();
    dateRanges.forEach((d,idx)=>{
        const item = $(`<span class="badge bg-primary me-1 mb-1">${d.label} <i data-idx="${idx}" class="fas fa-times ms-1 remove-date" style="cursor:pointer"></i></span>`);
        container.append(item);
    });
    // 绑定删除
    $('.remove-date').off('click').on('click', function(){
        const idx = $(this).data('idx');
        dateRanges.splice(idx,1);
        renderDateRangeList();
    });
}

function rangeToInterval(start, end){
    let s = start ? start.getTime() : -Infinity;
    let e = end   ? end.getTime()   :  Infinity;
    if(start && !end){ s += 1; }   // After, exclude the day
    if(!start && end){ e -= 1; }   // Before, exclude the day
    return {s,e};
}

function isOverlap(s1,e1){
    const nInt = rangeToInterval(s1,e1);
    for(const r of dateRanges){
        const rInt = rangeToInterval(r.start,r.end);
        if(!(nInt.e < rInt.s || rInt.e < nInt.s)){
            return true;
        }
    }
    return false;
}

function buildTable(){
    // 不再按日期排序，保持用户添加的先后顺序

    // 构建列
    const columns = [
        {title:'Code'},
        {title:'Count', className:'count-col'}
    ];
    dateRanges.forEach(r=>{
        if(!r.hidden){
            columns.push({title:r.label, className:'date-col'});
        }
    });

    // 生成数据
    const data = rawRows.map(row=>{
        const arr = [row.code, row.count.toString()];
        dateRanges.forEach(r=>{ if(!r.hidden){ arr.push(''); }});
        return arr;
    });

    inventoryTable = $('#inventoryTable').DataTable({
        paging:true,
        pageLength:5,
        lengthChange:false,
        searching:true,
        info:false,
        ordering:false,
        /* 启用横向滚动，防止列数过多时表格撑破容器 */
        scrollX:true,
        autoWidth:true,
        data:data,
        columns:columns,
        createdRow:function(row,data,dataIndex){
            $('td',row).attr('contenteditable',true);
            // 让除 Code 以外的列居中
            $('td:gt(0)',row).addClass('text-center');
        }
    });

    // 隐藏自带 filter
    $('#inventoryTable_filter').hide();

    // 初始化 entriesSelect 与 page length 同步
    $('#entriesSelect').val('5');
    $('#entriesSelect').off('change').on('change',function(){
        const v=parseInt($(this).val());
        inventoryTable.page.len(v).draw();
    });

    // 搜索框输入联动
    $('#codeSearch').off('input').on('input',function(){
        const val = this.value;
        $('#codeSearchClear').toggle(val.length>0);
        inventoryTable.column(0).search(val,false,false).draw();
    });

    // 清除搜索内容
    $('#codeSearchClear').off('click').on('click',function(){
        $('#codeSearch').val('');
        $(this).hide();
        inventoryTable.column(0).search('',false,false).draw();
    });

    // 同步用户编辑
    $('#inventoryTable').on('blur','td[contenteditable="true"]',function(){
        const cell = inventoryTable.cell(this);
        cell.data($(this).text().trim()).draw(false);
    });

    // 手动添加按钮
    $('#addManualBtn').off('click').on('click', function(){
        // 构造空行：Code 默认"新数据"，Count 0，其余列留空
        const newRow = [t('新数据','New Data'), '0'];
        dateRanges.forEach(r=>{ if(!r.hidden){ newRow.push(''); }});
        inventoryTable.row.add(newRow).draw(false);
        inventoryTable.page('last').draw('page');
    });
}

// ------------ 扫描功能 ------------
function openScanner(){
    $('#scannerModal').modal('show');
    startScanner();
    // 显示扫描手电筒按钮
    $('#flashToggleDuringScan').show();
    $('#flashToggleInOcr').hide();
    $('#zoomControls').show();
    $('#ocrZoomControls').hide();
}

function closeScannerModal(){
    $('#scannerModal').modal('hide');
    stopScanner();
    $('#flashToggleDuringScan').hide();
    $('#zoomControls').hide();
}

function startScanner(){
    if(scanning){return;}
    scanning = true;
    $('#loadingIndicator').removeClass('d-none');

    html5QrCode = new Html5Qrcode(/* element id */ 'scanner-container');
    const config = getOptimalScanConfig();
    html5QrCode.start({ facingMode: 'environment' }, config, handleBarcode, handleScanError)
        .then(()=>{
            $('#loadingIndicator').addClass('d-none');
            // 尝试开启闪光灯
            applyTorchState();
            applyZoomToActiveCamera();
        })
        .catch(err=>{ console.log(err); showToast(t('摄像头启动失败','Failed to start camera')); scanning=false; });
}

function stopScanner(){
    if(!scanning){return;}
    scanning = false;
    if(html5QrCode){
        html5QrCode.stop().then(()=>{ html5QrCode.clear(); html5QrCode=null; });
    }
}

let lastCode=''; let lastTime=0;
function handleBarcode(decodedText,decodedResult){
    const now = Date.now();
    if(decodedText === lastCode && now-lastTime < 300){return;} 
    lastCode = decodedText; lastTime = now;

    // 暂停扫描，而不是停止
    if(html5QrCode){
        try {
            html5QrCode.pause();
        } catch(e) { console.error("暂停扫描失败", e); }
    }

    showToast(t(`识别到条码 ${decodedText}`,`Barcode detected ${decodedText}`));

    // 检查条码是否存在
    const code = decodedText.trim();
    const existingRow = rawRows.find(row => row.code === code);
    const statusElement = $('#barcodeStatus');

    if (existingRow) {
        let statusText = `<strong>${existingRow.name || t('无品名','No name')}</strong> (${t('已在列表中','Already in list')})`;
        statusElement.html(statusText).removeClass('text-warning').addClass('text-success');
    } else {
        statusElement.html(`<strong>${t('条码不在列表中。','Barcode not in list.')}</strong><br>${t('确认后将创建新条目。','A new entry will be created.')}`).removeClass('text-success').addClass('text-warning');
    }

    // 显示条码确认弹窗
    $('#barcodeConfirmInput').val(code);
    $('#barcodeConfirmContainer').removeClass('d-none');
}

function handleScanError(err){
    // 忽略
}

function captureCurrentFrame(){
    const video = $('#scanner-container video').get(0);
    if(!video){return null;}
    const canvas = document.createElement('canvas');
    const maxW = 640;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/png');
}

async function initOcrWorker () {
    if (ocrWorkerReady)   return ocrWorkerReady;
    if (ocrWorker)        return ocrWorker;

    ocrWorkerReady = (async () => {
        const worker = await Tesseract.createWorker(
            "eng",
            1,
            { logger: m => console.log(m) }
        );
        ocrWorker = worker; 
        return worker;
    })();

    return ocrWorkerReady;
}

async function runOCR (dataUrl) {
    if (!dataUrl) return { dateStr: null, rawText: null };

    try {
        const worker = await initOcrWorker(); 
        const { data: { text } } = await worker.recognize(dataUrl);
        const raw   = text.trim();
        const date  = extractDate(raw);
        return { dateStr: date, rawText: raw };
    } catch (e) {
        console.error("OCR error", e);
        return { dateStr: null, rawText: null };
    }
}

function extractDate(text){
    if(!text){return null;}
    const monthMap = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    text = text.replace(/\n/g,' ');
    let m;

    function isValid(y,m,d){
        y=parseInt(y); m=parseInt(m); d=parseInt(d);
        if(y<2018||y>2028) return false;
        if(m<1||m>12) return false;
        const days=[31, (y%4===0&&y%100!==0)||y%400===0?29:28,31,30,31,30,31,31,30,31,30,31];
        if(d<1||d>days[m-1]) return false;
        return true;
    }

    // ① 带英文月份: "10 Feb 2025"
    m = text.match(/\b(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(20\d{2})\b/i);
    if(m){
        let day=m[1].padStart(2,'0');
        let month=monthMap[m[2].substr(0,3).toLowerCase()];
        let year=m[3];
        if(isValid(year,month,day)) return `${year}-${month}-${day}`;
    }

    // ② 纯数字分隔: "04/11/2022" 、"04-11-2022" 或 "04.11.2022"
    m = text.match(/\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](20\d{2})\b/);
    if(m){
        let day=m[1].padStart(2,'0');
        let month=m[2].padStart(2,'0');
        let year=m[3];
        if(isValid(year,month,day)) return `${year}-${month}-${day}`;
    }

    return null;
}

function updateCountForCode(code){
    let found = false;
    inventoryTable.rows().every(function(){
        const row = this.data();
        if(row[0] === code){
            const cnt = parseInt(row[1])||0;
            row[1] = (cnt+1).toString();
            this.data(row);
            found = true;
            return false;
        }
    });
    if(!found){
        // 创建新行
        const newRow = [code,'1'];
        dateRanges.forEach(r=>{ if(!r.hidden){ newRow.push(''); }});
        inventoryTable.row.add(newRow).draw(false);
    }
}

function updateCountForDate(code,dateStr){
    // 找到合适的日期列索引
    let colIdx = -1;
    dateRanges.forEach((r,idx)=>{
        if(r.hidden){return;}
        if(isDateInRange(dateStr,r.start,r.end)){
            // 表头: Code,Count 后面的顺序相同
            colIdx = 2 + visibleRangeIndex(idx);
        }
    });
    if(colIdx === -1){ return; }

    // 更新表格
    inventoryTable.rows().every(function(){
        const row = this.data();
        if(row[0] === code){
            const cnt = parseInt(row[colIdx])||0;
            row[colIdx] = (cnt+1).toString();
            this.data(row);
            return false;
        }
    });
}

function visibleRangeIndex(totalIdx){
    // 计算到目前为止 visible 索引 (不包括隐藏列)
    let v = -1;
    for(let i=0;i<=totalIdx;i++){
        if(!dateRanges[i].hidden){v++;}
    }
    return v;
}

function isDateInRange(dateStr,start,end){
    const d = new Date(dateStr).getTime();
    const interval = rangeToInterval(start,end);
    return d >= interval.s && d <= interval.e;
}

// ------------ 导出 & 复制 ------------
function copyTable(){
    const colCount = inventoryTable.columns().count();
    let text='';
    // header
    inventoryTable.columns().every(function(idx){
        text += $(inventoryTable.column(idx).header()).text() + (idx<colCount-1?'\t':'\n');
    });
    // body
    inventoryTable.rows().every(function(){
        const row = this.data();
        for(let i=0;i<row.length;i++){
            text += row[i] + (i<row.length-1?'\t':'\n');
        }
    });
    copyToClipboard(text);
    showToast(t('已复制到剪贴板','Copied to clipboard'));
}

function copyToClipboard(t){
    const tmp=$('<textarea>');
    tmp.val(t);$('body').append(tmp);tmp.select();document.execCommand('copy');tmp.remove();
}

function exportTable(){
    const data = [];
    // header
    const header=[];
    inventoryTable.columns().every(function(idx){header.push($(inventoryTable.column(idx).header()).text());});
    data.push(header);
    // body
    inventoryTable.rows().every(function(){data.push(this.data());});
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Inventory');
    XLSX.writeFile(wb,'inventory.xlsx');
}

// ------------ 工具函数 ------------
function formatDate(d){
    return d.toISOString().split('T')[0];
}

function stripTags(html){
    return html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}

function showToast(msg, duration=2000){
    const t = $('#toastMessage');
    t.text(msg).removeClass('d-none');
    clearTimeout(t.data('timeoutId'));
    const id = setTimeout(()=>t.addClass('d-none'), duration);
    t.data('timeoutId', id);
}

// 与模式 1 一致的扫描配置
function getOptimalScanConfig() {
    return {
        fps: 30,
        qrbox: {
            width: 250, 
            height: 100,
        },
        aspectRatio: 1.0,
        disableFlip: false,
        formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E
        ],
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
            facingMode: "environment",
            width:  { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
        }
    };
}

// OCR 模态框控制
function openOcrModal(){
    // 初始化 UI 状态
    $('#ocrVideo').removeClass('d-none');         // 显示视频流
    $('#ocrScannerBox').removeClass('d-none');    // 显示扫描框
    $('#ocrResult').removeClass('d-none');        // 允许显示识别文本
    $('#ocrConfirmArea').addClass('d-none').removeClass('quantity-modal');
    $('#ocrResult').text('');
    $('#confirmTitle').html('<span class="lang-zh">确认日期</span><span class="lang-en">Confirm Date</span>');
    $('#confirmDesc').html('<span class="lang-zh">识别到日期如下(可修改)</span><span class="lang-en">Recognized date below (editable)</span>');
    $('#selectedRangeDisplay').addClass('d-none');
    $('#dateInput').removeClass('d-none');
    $('#ocrOverlayText').removeClass('d-none');
    $('#ocrModal').modal('show');
    $('#flashToggleInOcr').show();
    $('#ocrZoomControls').show();
    $('#zoomControls').hide();

    // 确保任何关闭方式都能清理资源
    $('#ocrModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
        cleanupOcrResources();
    });

    // 打开摄像头流
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(stream=>{
        ocrStream = stream;
        enableTorchOnStream(stream, flashlightEnabled); // 打开闪光灯
        const videoEl = document.getElementById('ocrVideo');
        videoEl.srcObject = stream;
        videoEl.onloadedmetadata = () => applyZoom(videoEl);
        videoEl.play();
        applyZoom(videoEl);

        // 连续每0.5s识别一次
        ocrInterval = setInterval(()=>{
            captureOcrFrame(videoEl).then(result=>{
                const {dateStr,rawText}=result;
                if(rawText){ $('#ocrResult').text(rawText); }
                if(dateStr){
                    clearInterval(ocrInterval);
                    $('#ocrOverlayText').addClass('d-none');
                    // 暂停并隐藏视频和绿框，防止遮挡
                    videoEl.pause();
                    $('#ocrVideo').addClass('d-none');
                    $('#ocrScannerBox').addClass('d-none');

                    // 隐藏原始OCR文本
                    $('#ocrResult').addClass('d-none');

                    $('#dateInput').val(dateStr);

                    // 复用 mode1 的 quantity-modal 样式
                    $('#ocrConfirmArea').removeClass('d-none').addClass('quantity-modal');
                }
            });
        }, 500);
    }).catch(err=>{
        showToast(t('无法打开摄像头','Unable to open camera'));
        closeOcrModal();
    });

    // 绑定确认按钮
    $('#confirmDateBtn').text('确认').off('click').on('click', function(){
        const dateStr = $('#dateInput').val().trim();
        if(dateStr){
            updateCountForDate(currentCode, dateStr);
            showToast(t(`已确认日期 ${dateStr}`,`Date confirmed ${dateStr}`));
        }
        closeOcrModal();
    });

    // 绑定重新识别按钮
    $('#retryOcrBtn').text('重新识别').off('click').on('click', function(){
        // 恢复 UI
        $('#ocrConfirmArea').addClass('d-none');
        $('#ocrResult').removeClass('d-none').text('');
        $('#ocrOverlayText').removeClass('d-none');
        $('#ocrVideo').removeClass('d-none');
        $('#ocrScannerBox').removeClass('d-none');
        $('#manualBackdrop').addClass('d-none');
        $('#manualDateBtn').prop('disabled', false);

        const videoEl=document.getElementById('ocrVideo');
        if(videoEl.paused) videoEl.play();

        // 重启 OCR 定时器
        if(ocrInterval){clearInterval(ocrInterval);}
        ocrInterval=setInterval(()=>{
            captureOcrFrame(videoEl).then(res=>{
                const {dateStr,rawText}=res;
                if(rawText){ $('#ocrResult').text(rawText); }
                if(dateStr){
                    clearInterval(ocrInterval);
                    $('#ocrOverlayText').addClass('d-none');
                    videoEl.pause();
                    $('#ocrVideo').addClass('d-none');
                    $('#ocrScannerBox').addClass('d-none');
                    $('#ocrResult').addClass('d-none');
                    $('#dateInput').val(dateStr);
                    $('#ocrConfirmArea').removeClass('d-none').addClass('quantity-modal');
                }
            });
        },500);
    });

    // 手动选择日期按钮
    $('#manualDateBtn').off('click').on('click',function(){
        if(ocrInterval){clearInterval(ocrInterval);} // 停止 OCR 定时器
        const videoEl=document.getElementById('ocrVideo');
        if(videoEl) videoEl.pause();

        $('#ocrOverlayText').addClass('d-none');
        $('#ocrScannerBox').addClass('d-none');
        $('#ocrVideo').addClass('d-none');
        $('#ocrResult').addClass('d-none');

        generateManualOptions();
        $('#manualSelectArea').removeClass('d-none').addClass('quantity-modal');
        $('#manualBackdrop').removeClass('d-none');
        $('#manualDateBtn').prop('disabled', true);
    });
}

function cleanupOcrResources(){
    if(ocrInterval){
        clearInterval(ocrInterval);
        ocrInterval=null;
    }
    if(ocrStream){
        ocrStream.getTracks().forEach(t=>t.stop());
        ocrStream=null;
    }
}

function closeOcrModal(){
    cleanupOcrResources();
    if($('#ocrModal').is(':visible')){
        $('#ocrModal').modal('hide');
    }
    $('#manualBackdrop').addClass('d-none');
    $('#manualDateBtn').prop('disabled', false);
    $('#manualSelectArea').addClass('d-none');
    $('#ocrConfirmArea').addClass('d-none');
    scanningFlag=false;
    $('#flashToggleInOcr').hide();
    $('#ocrZoomControls').hide();
}

function captureOcrFrame(videoEl){
    return new Promise(resolve=>{
        if(!videoEl || videoEl.readyState<2){resolve({dateStr:null,rawText:null});return;}

        // 获取框相对位置
        const box=document.getElementById('ocrScannerBox');
        const videoRect=videoEl.getBoundingClientRect();
        const boxRect=box.getBoundingClientRect();

        // 计算在视频像素中的坐标
        const scaleX=videoEl.videoWidth / videoRect.width;
        const scaleY=videoEl.videoHeight / videoRect.height;
        const sx=(boxRect.left - videoRect.left)*scaleX;
        const sy=(boxRect.top - videoRect.top)*scaleY;
        const sw=boxRect.width*scaleX;
        const sh=boxRect.height*scaleY;

        const canvas=document.createElement('canvas');
        canvas.width=sw; canvas.height=sh;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);
        const dataUrl=canvas.toDataURL('image/png');
        runOCR(dataUrl).then(result=>{
            if(result.rawText){ console.log('OCR raw:', result.rawText); }
            resolve(result);
        });
    });
}

// -------- 手动选择日期 ---------
function generateManualOptions(){
    const container = $('#manualSelectArea');
    container.empty();
    const buttons = $('<div id="rangeButtons" class="d-grid gap-2"></div>');
    const visible = dateRanges.filter(r => !r.hidden);

    // 检查现有范围中是否已包含 Before / After
    const hasBefore = visible.some(r => !r.start && r.end);   // only end defined → Before
    const hasAfter  = visible.some(r => r.start && !r.end);   // only start defined → After

    // 取所有 start / end，用于生成缺失的边界选项
    const starts = visible.filter(r => r.start).map(r => r.start.getTime());
    const ends   = visible.filter(r => r.end).map(r => r.end.getTime());
    const minStart = starts.length ? new Date(Math.min(...starts)) : null;
    const maxEnd   = ends.length ? new Date(Math.max(...ends)) : null;

    const opts = [];

    // 如果没有 Before，就补一个最左侧 Before
    if (!hasBefore && minStart) {
        opts.push({
            label: buildLabel(null, minStart),
            start: null,
            end:   minStart
        });
    }

    // 保持用户定义顺序添加中间范围
    visible.forEach(r => opts.push({ label: r.label, start: r.start, end: r.end }));

    // 如果没有 After，就补一个最右侧 After
    if (!hasAfter && maxEnd) {
        opts.push({
            label: buildLabel(maxEnd, null),
            start: maxEnd,
            end:   null
        });
    }
    container.data('opts', opts);
    opts.forEach((o,i)=>{
        const btn = $(`<button class="btn btn-outline-light text-dark w-100"></button>`).html(o.label);
        btn.on('click',()=>openRangeConfirm(i));
        buttons.append(btn);
    });
    container.append('<h5 class="mb-3">Select a range</h5>');
    container.append(buttons);
}

function openRangeConfirm(idx){
    const opts = $('#manualSelectArea').data('opts') || [];
    const opt = opts[idx];
    if(!opt){return;}

    $('#manualSelectArea').addClass('d-none');
    $('#confirmTitle').html('<span>Confirm Range</span>');
    $('#confirmDesc').html('<span>Selected range</span>');
    $('#dateInput').addClass('d-none');
    $('#selectedRangeDisplay').removeClass('d-none').addClass('text-dark fw-bold').text(stripTags(opt.label));
    $('#ocrConfirmArea').removeClass('d-none').addClass('quantity-modal text-dark');

    $('#confirmDateBtn').text(t('确认','Confirm')).off('click').on('click',function(){
        const d = getDateForOption(opt);
        updateCountForDate(currentCode, d);
        closeOcrModal();
    });

    $('#retryOcrBtn').text(t('重新选择','Choose again')).off('click').on('click',function(){
        $('#ocrConfirmArea').addClass('d-none');
        $('#selectedRangeDisplay').addClass('d-none');
        $('#dateInput').removeClass('d-none');
        $('#confirmTitle').html('<span class="lang-zh">确认日期</span><span class="lang-en">Confirm Date</span>');
        $('#confirmDesc').html('<span class="lang-zh">识别到日期如下(可修改)</span><span class="lang-en">Recognized date below (editable)</span>');
        generateManualOptions();
        $('#manualSelectArea').removeClass('d-none');
    });
}

function getDateForOption(opt){
    if(!opt.start && opt.end){
        return formatDate(new Date(opt.end.getTime()-86400000));
    }
    if(opt.start && !opt.end){
        return formatDate(new Date(opt.start.getTime()+86400000));
    }
    return formatDate(opt.start || new Date());
}

// ========= 通用工具 =========
function enableTorchOnStream(stream, state=true){
    try{
        const track = stream && stream.getVideoTracks()[0];
        if(track){
            const cap = track.getCapabilities && track.getCapabilities();
            if(cap && cap.torch){
                track.applyConstraints({advanced:[{torch: state}]}).catch(()=>{});
            }
        }
    }catch(e){console.log('设置闪光灯失败',e);}
}

function applyTorchState(){
    if(html5QrCode && html5QrCode.applyVideoConstraints){
        html5QrCode.applyVideoConstraints({advanced:[{torch: flashlightEnabled}]}).catch(()=>{});
    }
    if(ocrStream){
        enableTorchOnStream(ocrStream, flashlightEnabled);
    }
}

function applyZoom(videoEl){
    if(!videoEl) return;
    try{
        const track = videoEl.srcObject && videoEl.srcObject.getVideoTracks && videoEl.srcObject.getVideoTracks()[0];
        if(track){
            const cap = track.getCapabilities ? track.getCapabilities() : {};
            if(cap.zoom){
                let zoom = currentZoom;
                if(cap.max && zoom > cap.max) zoom = cap.max;
                if(cap.min && zoom < cap.min) zoom = cap.min;
                track.applyConstraints({advanced:[{zoom: zoom}]}).catch(()=>{});
            }else{
                videoEl.style.transform = `scale(${currentZoom})`;
            }
        }else{
            videoEl.style.transform = `scale(${currentZoom})`;
        }
    }catch(e){
        videoEl.style.transform = `scale(${currentZoom})`;
    }
}

function applyZoomToActiveCamera(){
    applyZoom(document.querySelector('#scanner-container video'));
    applyZoom(document.getElementById('ocrVideo'));
}