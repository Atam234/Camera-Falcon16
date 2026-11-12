package com.falconcam.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Receives a recorded video from the web layer in base64 chunks, then saves it to the
 * phone gallery (Movies/FalconCam) or opens the Android share sheet.
 */
@CapacitorPlugin(
    name = "FalconGallery",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class FalconGalleryPlugin extends Plugin {

    private File tmpFile;
    private FileOutputStream out;
    private String mime = "video/mp4";

    @PluginMethod
    public void begin(PluginCall call) {
        try {
            closeQuietly();
            String name = call.getString("name", "falcon-cam.mp4").replaceAll("[^A-Za-z0-9._-]", "_");
            mime = call.getString("mime", "video/mp4");
            File dir = new File(getContext().getCacheDir(), "videos");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create cache dir");
            tmpFile = new File(dir, name);
            out = new FileOutputStream(tmpFile, false);
            call.resolve();
        } catch (Exception e) {
            call.reject("begin failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        try {
            if (out == null) throw new IOException("begin() not called");
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("append failed: " + e.getMessage(), e);
        }
    }

    /** Closes the temp file. Must be called before save() / share(). */
    @PluginMethod
    public void end(PluginCall call) {
        closeQuietly();
        JSObject r = new JSObject();
        r.put("size", tmpFile != null ? tmpFile.length() : 0);
        call.resolve(r);
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermCallback");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void storagePermCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSave(call);
        else call.reject("Storage permission denied");
    }

    private void doSave(PluginCall call) {
        try {
            if (tmpFile == null || !tmpFile.exists()) throw new IOException("No recorded video");
            JSObject r = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.DISPLAY_NAME, tmpFile.getName());
                v.put(MediaStore.Video.Media.MIME_TYPE, mime);
                v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/FalconCam");
                v.put(MediaStore.Video.Media.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new IOException("MediaStore insert failed");
                try (InputStream in = new FileInputStream(tmpFile); OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new IOException("Cannot open gallery file");
                    copy(in, os);
                }
                v.clear();
                v.put(MediaStore.Video.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                r.put("path", "Movies/FalconCam/" + tmpFile.getName());
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "FalconCam");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create Movies/FalconCam");
                File dst = new File(dir, tmpFile.getName());
                try (InputStream in = new FileInputStream(tmpFile); OutputStream os = new FileOutputStream(dst)) {
                    copy(in, os);
                }
                MediaScannerConnection.scanFile(getContext(), new String[] { dst.getAbsolutePath() }, new String[] { mime }, null);
                r.put("path", dst.getAbsolutePath());
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            if (tmpFile == null || !tmpFile.exists()) throw new IOException("No recorded video");
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", tmpFile);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri("", uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "I-share ang video");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage(), e);
        }
    }

    private static void copy(InputStream in, OutputStream os) throws IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
    }

    private void closeQuietly() {
        if (out != null) {
            try { out.close(); } catch (IOException ignored) { }
            out = null;
        }
    }
}
