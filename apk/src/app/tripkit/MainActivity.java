package app.tripkit;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * TripKit: wraps the offline web app in a WebView.
 * - App files are bundled in the APK (assets/www) and served from a fake https origin,
 *   so localStorage persists and nothing needs a server.
 * - OpenStreetMap tiles are cached to app storage forever once viewed or downloaded.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST + "/";
    static final int REQ_FILE = 1, REQ_EXPORT = 2, REQ_LOC = 3;

    WebView web;
    File mapDir;
    ValueCallback<Uri[]> fileCb;
    String pendingExport;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        mapDir = new File(getFilesDir(), "ofm");
        // v1.0 cached OpenStreetMap tiles (some were "blocked" images) — remove them
        final File old = new File(getFilesDir(), "tiles");
        if (old.exists()) new Thread(new Runnable() { public void run() { wipe(old); old.delete(); } }).start();
        web = new WebView(this);
        web.setBackgroundColor(0xFF0F1720);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
        }
        if (b != null) web.restoreState(b);
        else web.loadUrl(ORIGIN + "index.html");
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.tkBack ? tkBack() : false", new ValueCallback<String>() {
            public void onReceiveValue(String v) { if (!"true".equals(v)) MainActivity.super.onBackPressed(); }
        });
    }

    /* ---------- request handling ---------- */
    class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String host = u.getHost() == null ? "" : u.getHost();
            if (HOST.equals(host)) return asset(u.getPath());
            if (host.equals("tiles.openfreemap.org")) return ofm(u);
            if (host.equals("upload.wikimedia.org")) return photo(u);
            if ((host.equals("overpass-api.de") || host.equals("routing.openstreetmap.de")) && "GET".equals(req.getMethod())) return passthrough(u);
            return null;
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            Uri u = Uri.parse(url);
            if (HOST.equals(u.getHost())) return false;
            openExternal(u);
            return true;
        }
    }

    void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) {
            if ("geo".equals(u.getScheme())) {
                // No maps app installed: fall back to OpenStreetMap in the browser
                String q = u.getSchemeSpecificPart().split("\\?")[0];
                String[] ll = q.split(",");
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.openstreetmap.org/?mlat=" + ll[0] + "&mlon=" + ll[1] + "#map=17/" + ll[0] + "/" + ll[1]))); return; }
                catch (Exception ignored) { }
            }
            toast("No app can open this link");
        }
    }

    static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "application/javascript"); MIME.put("css", "text/css");
        MIME.put("png", "image/png"); MIME.put("json", "application/json"); MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml"); MIME.put("txt", "text/plain");
    }

    WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String ext = path.substring(path.lastIndexOf('.') + 1);
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open("www" + path);
            return new WebResourceResponse(mime, "utf-8", in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", cors(), new ByteArrayInputStream(new byte[0]));
        }
    }

    Map<String, String> cors() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "max-age=31536000");
        return h;
    }

    static final java.util.regex.Pattern TILE = java.util.regex.Pattern.compile("^/planet/[^/]+/(\\d+)/(\\d+)/(\\d+)\\.pbf$");

    /** OpenFreeMap: tiles, fonts and sprites cache-first (kept forever); style + tilejson network-first. */
    WebResourceResponse ofm(Uri u) {
        String path = u.getPath() == null ? "/" : u.getPath();
        java.util.regex.Matcher m = TILE.matcher(path);
        String key = m.matches() ? "planet/" + m.group(1) + "/" + m.group(2) + "/" + m.group(3) + ".pbf"
                                 : path.replaceAll("[^A-Za-z0-9._/@-]", "_").replaceAll("^/+", "");
        if (key.isEmpty() || key.contains("..")) key = "_root";
        boolean networkFirst = path.startsWith("/styles/") || !path.substring(1).contains("/");
        if (networkFirst) key = key + ".json";
        File f = new File(mapDir, key);
        String mime = key.endsWith(".pbf") ? "application/x-protobuf" : key.endsWith(".png") ? "image/png" : "application/json";
        try {
            if (networkFirst || !f.exists()) {
                try {
                    byte[] data = download(u.toString());
                    f.getParentFile().mkdirs();
                    File tmp = new File(f.getPath() + ".part");
                    FileOutputStream fo = new FileOutputStream(tmp);
                    fo.write(data); fo.close();
                    tmp.renameTo(f);
                } catch (Exception netErr) {
                    if (!f.exists()) throw netErr; // offline + nothing saved
                }
            }
            return new WebResourceResponse(mime, null, 200, "OK", cors(), new FileInputStream(f));
        } catch (Exception e) {
            return new WebResourceResponse(mime, null, 504, "Offline", cors(), new ByteArrayInputStream(new byte[0]));
        }
    }

    /** Wikimedia photos: cache-first in filesDir/photos, kept for offline. */
    WebResourceResponse photo(Uri u) {
        String path = u.getPath() == null ? "x" : u.getPath();
        String key = path.replaceAll("[^A-Za-z0-9._-]", "_");
        if (key.length() > 180) key = key.substring(key.length() - 180);
        File f = new File(new File(getFilesDir(), "photos"), key);
        String mime = key.toLowerCase().endsWith(".png") ? "image/png" : key.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
        try {
            if (!f.exists()) {
                byte[] data = download(u.toString());
                f.getParentFile().mkdirs();
                File tmp = new File(f.getPath() + ".part");
                FileOutputStream fo = new FileOutputStream(tmp); fo.write(data); fo.close();
                tmp.renameTo(f);
            }
            return new WebResourceResponse(mime, null, 200, "OK", cors(), new FileInputStream(f));
        } catch (Exception e) {
            return new WebResourceResponse(mime, null, 504, "Offline", cors(), new ByteArrayInputStream(new byte[0]));
        }
    }

    /** Route lookups (Overpass railway geometry, OSRM roads): fetched with the app's own User-Agent; results are cached by the web layer. */
    WebResourceResponse passthrough(Uri u) {
        try {
            byte[] data = download(u.toString(), 95000);
            return new WebResourceResponse("application/json", "utf-8", 200, "OK", cors(), new ByteArrayInputStream(data));
        } catch (Exception e) {
            return new WebResourceResponse("application/json", "utf-8", 504, "Offline", cors(), new ByteArrayInputStream("{}".getBytes()));
        }
    }

    static byte[] download(String url) throws Exception { return download(url, 20000); }

    static byte[] download(String url, int readTimeout) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("User-Agent", "TripKit/1.8 (Android; personal offline trip planner)");
        c.setConnectTimeout(8000);
        c.setReadTimeout(readTimeout);
        int code = c.getResponseCode();
        if (code != 200) throw new Exception("HTTP " + code);
        InputStream in = c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384]; int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toByteArray();
    }

    /* ---------- GPS + file picker ---------- */
    class Chrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            cb.invoke(origin, true, true);
        }

        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try { startActivityForResult(i, REQ_FILE); }
            catch (Exception e) { fileCb = null; toast("No file picker available"); return false; }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE) {
            if (fileCb != null) {
                Uri u = (res == RESULT_OK && data != null) ? data.getData() : null;
                fileCb.onReceiveValue(u == null ? null : new Uri[]{u});
                fileCb = null;
            }
        } else if (req == REQ_EXPORT) {
            if (res == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try {
                    OutputStream o = getContentResolver().openOutputStream(data.getData(), "wt");
                    o.write(pendingExport.getBytes("UTF-8"));
                    o.close();
                    toast("Backup saved ✓");
                } catch (Exception e) { toast("Save failed: " + e.getMessage()); }
            }
            pendingExport = null;
        }
    }

    void toast(final String m) {
        runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show(); } });
    }

    /* ---------- JS bridge ---------- */
    class Bridge {
        @JavascriptInterface public boolean isApp() { return true; }

        @JavascriptInterface
        public void exportJson(final String name, String json) {
            pendingExport = json;
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    startActivityForResult(i, REQ_EXPORT);
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String title, final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, title);
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(i, title));
                }
            });
        }

        @JavascriptInterface public int tileCount() { return count(mapDir); }
        @JavascriptInterface public void clearTiles() { wipe(mapDir); }

        @JavascriptInterface public void openUrl(String url) { openExternal(Uri.parse(url)); }
    }

    static int count(File d) {
        File[] fs = d.listFiles(); if (fs == null) return 0;
        int n = 0; for (File f : fs) n += f.isDirectory() ? count(f) : (f.getName().endsWith(".pbf") ? 1 : 0);
        return n;
    }
    static void wipe(File d) {
        File[] fs = d.listFiles(); if (fs == null) return;
        for (File f : fs) { if (f.isDirectory()) wipe(f); f.delete(); }
    }
}
