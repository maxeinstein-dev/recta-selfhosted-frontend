package dev.maxsueleinstein.recta;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import dev.maxsueleinstein.recta.capture.CaptureReaderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate() builds the bridge.
        registerPlugin(CaptureReaderPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor 8 core registers no back handling, so the Activity finished on every back press. The back button
        // asks the page (window.__rectaNativeBack, see src/native/nativeBack.ts): the page closes its layer or goes back
        // in its own history, and only answers "exit" when there is nothing left, then the Activity leaves as usual.
        // If the page does not answer (not loaded, or an error), the app leaves, as it did before.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().eval("(window.__rectaNativeBack ? window.__rectaNativeBack() : 'exit')", result -> {
                    if (result == null || result.contains("exit")) {
                        setEnabled(false);
                        MainActivity.this.getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                });
            }
        });
    }
}
