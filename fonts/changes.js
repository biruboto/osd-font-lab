diff --git a/c:\Users\birub\OneDrive\Desktop\osd-font-lab\js/app.js b/c:\Users\birub\OneDrive\Desktop\osd-font-lab\js/app.js
--- a/c:\Users\birub\OneDrive\Desktop\osd-font-lab\js/app.js
+++ b/c:\Users\birub\OneDrive\Desktop\osd-font-lab\js/app.js
@@ -112,3 +112,3 @@
 
-    // ASCII section: 0x20..0x5F (32..95) is â€œASCII for printing stringsâ€
+    // ASCII section: 0x20..0x5F (32..95) is "ASCII for printing strings"
     // Special callouts inside ASCII block:
@@ -189,3 +189,3 @@
     const ch = String.fromCharCode(idx);
-    return ch === " " ? "SPACE" : `â€œ${ch}â€`;
+    return ch === " " ? "SPACE" : `"${ch}"`;
   }
@@ -193,3 +193,3 @@
   function logoLabel(idx) {
-    // After 0xA0 â€œlogo starts hereâ€ through 0xFE are effectively logo/splash tiles
+    // After 0xA0 "logo starts here" through 0xFE are effectively logo/splash tiles
     if (idx < 0xA0 || idx > 0xFE) return null;
@@ -278,3 +278,3 @@
   caret.className = "fontpicker-caret";
-  caret.textContent = "â–¾";
+  caret.textContent = "v";
 
@@ -510,3 +510,3 @@
 
-  // IMPORTANT: do NOT fill the canvas â€” leave it transparent
+  // IMPORTANT: do NOT fill the canvas - leave it transparent
 
@@ -1598,2 +1598,2 @@
 
-init();
\ No newline at end of file
+init();
