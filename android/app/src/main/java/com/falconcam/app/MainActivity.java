package com.falconcam.app;

import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FalconGalleryPlugin.class);
        super.onCreate(savedInstanceState);
        // Camera app: keep the screen on while it is open.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // If the WebView's renderer dies (low memory, audio/camera driver issue…), Android
        // would otherwise kill the whole app. Restart the screen instead.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                Log.e("FalconCam", "WebView renderer gone, crash=" + detail.didCrash());
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Nag-restart ang Falcon Cam", Toast.LENGTH_SHORT).show();
                    recreate();
                });
                return true;
            }
        });
    }
}
