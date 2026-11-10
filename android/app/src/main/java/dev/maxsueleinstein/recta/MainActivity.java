package dev.maxsueleinstein.recta;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.maxsueleinstein.recta.capture.CaptureReaderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate() builds the bridge.
        registerPlugin(CaptureReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
