document.getElementById('startBtn').addEventListener('click', () => {
  const appNo = document.getElementById('appNo').value.trim();
  if (!appNo) {
    alert("Lütfen bir başvuru numarası girin!");
    return;
  }

  // Durumu sıfırla ve numarayı kaydet
chrome.storage.local.set({
  tp_app_no: appNo,
  tp_step: "LOGIN_REQUIRED",
  tp_clicked_ara: false,
  tp_download_clicked: false,
  tp_expanded_twice: false
}, () => {
  chrome.tabs.create({ url: "https://epats.turkpatent.gov.tr/run/TP/EDEVLET/giris" });
});
});