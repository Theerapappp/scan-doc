import React, { useState, useRef } from 'react';
import { Upload, Crop, FileText, CheckCircle, AlertCircle, Loader2, RotateCcw, Image as ImageIcon } from 'lucide-react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
// การตั้งค่า API
const apiKey = "YOUR API";

// ฟังก์ชันช่วยสำหรับการทำ Exponential Backoff (ลองเรียก API ซ้ำถ้าล้มเหลว)
const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};

export default function App() {
  // State Management (จัดการสถานะของแอป)
  const [originalImage, setOriginalImage] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);

  // สถานะการตัดรูป (Crop)
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const imageRef = useRef(null);

  // สถานะการวิเคราะห์ AI
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showResult, setShowResult] = useState(false);

  // ฟังก์ชันการทำงาน (Handlers)

  // 1. จัดการเมื่อผู้ใช้อัปโหลดรูปภาพ
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setOriginalImage(event.target.result);
        setCroppedImage(null);
        setExtractedData(null);
        setErrorMsg('');
        setIsCropping(true);
        setCrop(undefined);
        setCompletedCrop(null);
        setShowResult(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // รีเซ็ตเพื่อเริ่มใหม่
  const resetProcess = () => {
    setOriginalImage(null);
    setCroppedImage(null);
    setExtractedData(null);
    setErrorMsg('');
    setShowResult(false);
  };

  // ประมวลผลการตัดรูปประยุกต์ใหม่ด้วยข้อมูลจาก ReactCrop
  const applyCrop = () => {
    if (!completedCrop || !imageRef.current || completedCrop.width === 0 || completedCrop.height === 0) {
      setCroppedImage(originalImage); // ถ้าไม่ได้ลากครอบ ให้ใช้รูปเต็ม
      setIsCropping(false);
      return;
    }

    const image = imageRef.current;
    if (!image) return;

    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    // ตั้งค่า pixel ratio ให้ภาพชัดเจน
    const pixelRatio = window.devicePixelRatio;
    canvas.width = Math.floor(completedCrop.width * scaleX * pixelRatio);
    canvas.height = Math.floor(completedCrop.height * scaleY * pixelRatio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingQuality = 'high';

    const cropX = completedCrop.x * scaleX;
    const cropY = completedCrop.y * scaleY;
    const cropWidth = completedCrop.width * scaleX;
    const cropHeight = completedCrop.height * scaleY;

    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    setCroppedImage(canvas.toDataURL('image/jpeg', 0.95)); // คุณภาพสูง
    setIsCropping(false);
  };

  // --- ระบบ AI วิเคราะห์เอกสาร ---
  const analyzeDocument = async () => {
    if (!apiKey) {
      setErrorMsg("กรุณาใส่ API Key ในโค้ดก่อนเริ่มการวิเคราะห์");
      return;
    }
    if (!croppedImage) return;

    setIsAnalyzing(true);
    setErrorMsg('');
    setExtractedData(null);
    setShowResult(false);

    // ดึงเฉพาะข้อมูล Base64 ไม่เอา Header
    const base64Data = croppedImage.split(',')[1];

    const promptText = `
    คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์และดึงข้อมูลจากเอกสาร (Advanced OCR & Document Extraction)
    กรุณาอ่านและดึงข้อความทั้งหมดจากภาพเอกสารนี้ 
    
    หลังจากดึงข้อความแล้ว ให้จัดกลุ่มข้อความเหล่านั้นเป็น "หัวข้อ (Categories)" ให้เหมาะสมกับประเภทของเอกสารที่เห็น
    หากภาพมีเอกสารหลายหน้าหรือหลายแผ่นที่แยกกันชัดเจน ให้ตอบกลับเป็น Array ของ JSON Object โดยแต่ละ Object คือเอกสาร 1 แผ่น
    แต่หากมีแค่แผ่นเดียว หรือหน้าเดียว ให้ตอบเป็น JSON Object เดี่ยวๆ หรือ Array ที่มีแค่ 1 Object ก็ได้
    
    ตอบกลับในรูปแบบของ JSON เท่านั้น โดยให้ Key เป็นชื่อหัวข้อ (ภาษาไทย) และ Value เป็นข้อมูลที่ดึงมาได้ ห้ามใส่ markdown หรือคำอธิบายอื่นนอกเหนือจาก JSON ล้วนๆ
    `;

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json" // บังคับให้ตอบเป็น JSON
      }
    };

    try {
      // ใช้โมเดลเวอร์ชันล่าสุดที่เสถียรสำหรับรูปภาพและข้อความ
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const result = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) throw new Error("ไม่ได้รับข้อมูลตอบกลับจากระบบ AI");

      let parsedData;
      try {
        parsedData = JSON.parse(responseText);
      } catch (parseErr) {
        const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedData = JSON.parse(cleanedText);
      }

      setExtractedData(parsedData);

    } catch (err) {
      console.error("Analysis Error:", err);
      setErrorMsg("เกิดข้อผิดพลาดในการวิเคราะห์ (ตรวจสอบ API Key หรือเวอร์ชันของ Model)");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ส่วนแสดงผล (Render Helpers)



  // แสดงผล JSON ออกมาในรูปแบบที่เหมือนกระดาษ
  const renderPaperContent = (data, depth = 0) => {
    if (typeof data !== 'object' || data === null) {
      return <span className="text-slate-800 break-words font-medium">{String(data)}</span>;
    }

    if (Array.isArray(data)) {
      return (
        <ul className="list-disc list-inside space-y-1 ml-1 sm:ml-2 text-slate-800 mt-1">
          {data.map((item, index) => (
            <li key={index} className="text-sm sm:text-base leading-relaxed">
              {renderPaperContent(item, depth + 1)}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <div className={`space-y-4 ${depth > 0 ? 'ml-2 sm:ml-4 border-l-2 border-slate-200 pl-3 sm:pl-4 mt-3' : ''}`}>
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex flex-col border-b border-slate-100 pb-3 last:border-0 last:pb-0">
            <h4 className="text-xs sm:text-sm font-bold text-slate-500 uppercase tracking-wider mb-1 opacity-90">{key}</h4>
            <div className="text-slate-800 text-sm sm:text-base">
              {renderPaperContent(value, depth + 1)}
            </div>
          </div>
        ))}
      </div>
    );
  };
  // โครงสร้างหน้าเว็บหลัก
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans pb-8 sm:pb-12 selection:bg-slate-200">
      {/* Header มินิมอล & Premium Glassmorphism */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 pt-4 pb-4 px-4 sm:px-8 shrink-0">
        <div className="w-full max-w-[1920px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-2.5 rounded-[1.2rem] shadow-lg shadow-slate-900/10 transition-transform duration-300">
              <Crop className="w-5 h-5 sm:w-6 sm:h-6 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">Scan & Extract</h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium tracking-wide mt-0.5">AI Document Analyzer</p>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1920px] mx-auto mt-4 sm:mt-8 px-4 lg:px-8 xl:px-12 flex-1 flex flex-col space-y-6 xl:space-y-8">

        {/* ส่วนโต้ตอบหลัก */}
        {(!showResult || !extractedData) && (
          <section className={`transition-all duration-700 bg-white rounded-2xl xl:rounded-[2.5rem] shadow-sm hover:shadow-md border border-slate-200/60 overflow-hidden flex flex-col ${originalImage ? 'p-4 sm:p-6 lg:p-8 flex-1' : 'p-6 sm:p-12 lg:p-20 w-full xl:w-2/3 2xl:w-1/2 mx-auto mt-8 xl:mt-12 shrink-0'}`}>

            {/* สถานะที่ 1: ยังไม่อัปโหลดรูป */}
            {!originalImage && (
              <div className="group relative border-2 border-dashed border-slate-200 rounded-[2rem] p-8 sm:p-16 text-center hover:bg-slate-50 hover:border-slate-300 transition-all duration-500 cursor-pointer flex flex-col items-center justify-center min-h-[300px] xl:min-h-[500px] flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  id="image-upload"
                />
                <div className="bg-slate-100 p-6 rounded-full text-slate-900 mb-8 group-hover:-translate-y-2 group-hover:bg-slate-200 transition-all duration-300 shadow-sm group-hover:shadow-md">
                  <Upload className="w-8 h-8 sm:w-12 sm:h-12" strokeWidth={1.5} />
                </div>
                <h3 className="text-2xl sm:text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Upload Document</h3>
                <p className="text-slate-500 text-sm sm:text-lg max-w-md mx-auto mb-10 leading-relaxed font-medium">
                  Drop your image here or tap to browse. Optimized for receipts, forms, and identification cards.
                </p>
                <div className="inline-flex items-center justify-center px-8 lg:px-10 py-3 lg:py-4 bg-slate-900 text-white font-semibold text-sm sm:text-base rounded-full hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20 active:scale-95 duration-200">
                  Select Photo to Analyze
                </div>
              </div>
            )}

            {/* Desktop UI: ใช้ xl:flex-row เพื่อแบ่งหน้าซ้ายขวาเมื่อมีการอัปโหลดรูป ให้กางเต็มจอแนวนอน */}
            {originalImage && (
              <div className="flex flex-col xl:flex-row gap-8 xl:gap-8 items-stretch justify-center flex-1 h-full">

                {/* คอลัมน์ซ้ายหน้าจอใหญ่: การครอปภาพ หรือ ดูพรีวิว */}
                <div className={`w-full ${isCropping ? 'lg:w-[65%]' : 'lg:w-1/2'} transition-all duration-500 flex flex-col`}>
                  {/* สถานะที่ 2: อัปโหลดแล้ว กำลังตัดภาพ */}
                  {isCropping && (
                    <div className="space-y-4 lg:space-y-6 flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                        <div>
                          <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2.5">
                            <ImageIcon className="w-5 h-5 text-slate-400" />
                            Step 1: Crop Image
                          </h3>
                          <p className="text-sm text-slate-500 mt-1 font-medium">Drag the handles to select the specific area.</p>
                        </div>

                        <div className="flex w-full sm:w-auto gap-3">
                          <button onClick={resetProcess} className="flex-1 sm:flex-none justify-center px-4 py-2.5 sm:py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 transition-colors">
                            <RotateCcw className="w-4 h-4" /> <span className="hidden sm:inline">Reset</span>
                          </button>
                          <button onClick={applyCrop} className="flex-1 sm:flex-none justify-center px-6 py-2.5 sm:py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl flex items-center gap-2 shadow-md hover:shadow-lg transition-all">
                            <Crop className="w-4 h-4" /> Confirm
                          </button>
                        </div>
                      </div>

                      <div className="bg-slate-50/50 p-2 sm:p-6 rounded-2xl flex justify-center items-center overflow-auto border border-slate-100 relative min-h-[300px] lg:min-h-[500px] flex-1">
                        <ReactCrop
                          crop={crop}
                          onChange={(pixelCrop, percentCrop) => setCrop(percentCrop)}
                          onComplete={(c) => setCompletedCrop(c)}
                          className="max-w-full lg:max-w-2xl max-h-[60vh] lg:max-h-[65vh] shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-[0.5rem] overflow-hidden group border border-slate-200/50"
                        >
                          <img
                            ref={imageRef}
                            src={originalImage}
                            alt="Original"
                            className="object-contain block max-w-full"
                            style={{ maxHeight: '65vh' }}
                            onLoad={(e) => {
                              setCrop({
                                unit: '%',
                                width: 90,
                                height: 90,
                                x: 5,
                                y: 5
                              });
                            }}
                          />
                        </ReactCrop>
                      </div>
                    </div>
                  )}

                  {/* แสดงรูปพรีวิว (เมื่อครอปเสร็จแล้ว) */}
                  {!isCropping && croppedImage && (
                    <div className="bg-slate-50/50 p-6 rounded-3xl border border-slate-100 flex flex-col justify-center items-center shadow-inner relative h-full min-h-[300px] lg:min-h-[500px] flex-1">
                      <img src={croppedImage} alt="Cropped Preview" className="max-w-full rounded-2xl object-contain max-h-[400px] lg:max-h-[500px] shadow-lg border border-slate-200/50" />
                    </div>
                  )}
                </div>

                {/* คอลัมน์ขวาหน้าจอใหญ่: การวิเคราะห์ AI (หรือ Placeholder รอยืนยันครอป) */}
                <div className={`w-full ${isCropping ? 'lg:w-[35%]' : 'lg:w-1/2'} flex flex-col justify-center mt-6 lg:mt-0`}>

                  {/* แสดงขณะกำลัง Crop ให้ฝั่งขวาดูไม่โล่งเกินไป */}
                  {isCropping && (
                    <div className="hidden lg:flex flex-col items-center justify-center p-12 text-center opacity-60 flex-1">
                      <div className="bg-slate-100 p-5 rounded-full mb-6">
                        <Crop className="w-8 h-8 text-slate-400" />
                      </div>
                      <h4 className="text-xl font-bold text-slate-800 mb-2">Awaiting Selection</h4>
                      <p className="text-slate-500 font-medium max-w-[250px]">Please confirm your crop selection on the left to proceed with AI extraction.</p>
                    </div>
                  )}

                  {/* สถานะที่ 3: ตัดภาพเสร็จแล้ว เตรียมส่งให้ AI */}
                  {croppedImage && !isCropping && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-700">

                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                        <div>
                          <h3 className="text-lg sm:text-2xl font-bold flex items-center gap-2.5 tracking-tight">
                            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-slate-900" />
                            Analysis Ready
                          </h3>
                          <p className="text-sm sm:text-base text-slate-500 mt-1 font-medium">Verify image and start extraction.</p>
                        </div>
                        <button onClick={() => setIsCropping(true)} className="px-5 py-2.5 sm:py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 rounded-xl transition-colors shadow-sm w-full sm:w-auto">
                          Adjust Crop
                        </button>
                      </div>

                      <div className="space-y-6 lg:p-4">
                        <h4 className="text-xl lg:text-2xl font-bold text-slate-900">Extract Information</h4>
                        <p className="text-slate-500 text-base lg:text-lg leading-relaxed font-medium">
                          Our AI intelligence engine will scan the text in this image, localize key structures, and automatically categorize the data for you.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 mt-8">
                          {!extractedData ? (
                            <button
                              onClick={analyzeDocument}
                              disabled={isAnalyzing}
                              className="w-full py-4 lg:py-5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-[1rem] flex items-center justify-center gap-3 transition-all shadow-xl shadow-slate-900/10 text-lg hover:-translate-y-1 active:translate-y-0"
                            >
                              {isAnalyzing ? (
                                <><Loader2 className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" /> Analyzing...</>
                              ) : (
                                <><CheckCircle className="w-6 h-6 sm:w-7 sm:h-7" /> Analysis data</>
                              )}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={analyzeDocument}
                                disabled={isAnalyzing}
                                className="w-full sm:w-1/3 py-4 lg:py-5 text-slate-700 bg-white border-2 border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-bold rounded-[1rem] flex items-center justify-center gap-3 transition-all shadow-sm active:scale-95 duration-200"
                              >
                                <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" /> {isAnalyzing ? 'Analyzing...' : 'Reset'}
                              </button>
                              <button
                                onClick={() => {
                                  setShowResult(true);
                                  setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
                                }}
                                className="w-full sm:w-2/3 py-4 lg:py-5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-[1rem] flex items-center justify-center gap-3 transition-all shadow-xl shadow-slate-900/10 text-lg hover:-translate-y-1 active:translate-y-0"
                              >
                                <CheckCircle className="w-6 h-6 sm:w-7 sm:h-7" /> Confirm
                              </button>
                            </>
                          )}
                        </div>

                        {/* แสดง Error */}
                        {errorMsg && (
                          <div className="bg-red-50 text-red-800 p-4 lg:p-5 rounded-xl flex items-start gap-4 border border-red-100 animate-in fade-in zoom-in-95 mt-6 shadow-sm">
                            <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-red-600" />
                            <p className="text-sm lg:text-base font-medium leading-relaxed">{errorMsg}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ส่วนแสดงผลลัพธ์จาก AI (หน้าแยก) */}
        {showResult && extractedData && (
          <section className="bg-slate-50/80 p-6 sm:p-8 xl:p-10 rounded-2xl xl:rounded-[2.5rem] shadow-inner border border-slate-200/60 animate-in fade-in zoom-in-95 duration-700 overflow-hidden relative flex-1 flex flex-col">

            <div className="relative z-10 w-full max-w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8 pb-6 border-b border-slate-200/80">
                <div className="flex items-center gap-5">
                  <div className="bg-white p-4 rounded-2xl text-slate-900 shadow-md border border-slate-100">
                    <FileText className="w-7 h-7" strokeWidth={2.5} />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Structured Result</h2>
                    <p className="text-sm sm:text-base text-green-700 mt-1.5 font-bold bg-green-50 inline-flex px-3 py-1 rounded-full items-center gap-1.5 border border-green-100/80">
                      <CheckCircle className="w-3.5 h-3.5" /> Analysis Complete
                    </p>
                  </div>
                </div>
                <button onClick={resetProcess} className="px-8 py-4 text-sm font-bold text-slate-700 bg-white border-2 border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 rounded-xl flex items-center justify-center gap-2 transition-all w-full sm:w-auto shadow-sm active:scale-95 duration-200">
                  <Upload className="w-4 h-4" /> Scan Another Document
                </button>
              </div>

              {/* คอนเทนเนอร์กระดาษ แนวตั้งสำหรับทุกขนาดหน้าจอ */}
              <div className="flex flex-col items-center gap-8 sm:gap-12 pb-12 pt-6 px-2 sm:px-6 min-h-[500px]">
                {Array.isArray(extractedData)
                  ? extractedData.map((item, i) => (
                    <div key={i} className="bg-[#fcfbf9] p-8 sm:p-12 w-[90vw] sm:w-[500px] lg:w-full lg:max-w-3xl shrink-0 rounded-sm shadow-[0_15px_40px_-5px_rgba(0,0,0,0.15),_0_2px_10px_rgba(0,0,0,0.05)] border border-slate-200 relative transform transition-transform hover:-translate-y-1">
                      {/* ขอบกระดาษด้านบน */}
                      <div className="absolute top-0 left-0 w-full h-[8px] bg-slate-200/70 border-b border-slate-300/50"></div>
                      <div className="absolute top-6 right-8 text-slate-300 font-serif text-5xl opacity-40 select-none tracking-tighter">{i + 1}</div>
                      {renderPaperContent(item)}
                    </div>
                  ))
                  : (
                    <div className="bg-[#fcfbf9] p-8 sm:p-12 w-[90vw] sm:w-[500px] lg:w-full lg:max-w-3xl shrink-0 rounded-sm shadow-[0_15px_40px_-5px_rgba(0,0,0,0.15),_0_2px_10px_rgba(0,0,0,0.05)] border border-slate-200 relative mx-auto transition-transform hover:-translate-y-1">
                      {/* ขอบกระดาษด้านบน */}
                      <div className="absolute top-0 left-0 w-full h-[8px] bg-slate-200/70 border-b border-slate-300/50"></div>
                      {renderPaperContent(extractedData)}
                    </div>
                  )}
              </div>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
