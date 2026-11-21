// ตั้งค่าระบบ — แก้ไฟล์นี้หลัง Deploy Apps Script แล้ว
window.QR_CONFIG = {
  // URL ของ Apps Script Web App (ลงท้ายด้วย /exec)
  API_URL: "https://script.google.com/macros/s/AKfycbxeElw_7MX7hgZVncyOt6dYQCfcrVJsPYaFKcKv-ojd4cFTt__t4Yz1DSTONPObRLYH/exec",

  // URL ของหน้าสแกน (ที่ใส่ใน QR) — เว้นว่างไว้ได้ ระบบจะใช้โฟลเดอร์เดียวกับ admin.html
  // ตัวอย่าง: "https://yourname.github.io/qr/"
  SCAN_BASE_URL: ""
};
