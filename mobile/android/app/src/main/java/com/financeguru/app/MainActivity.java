package com.financeguru.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);   // our native bank-SMS reader
        super.onCreate(savedInstanceState);
    }
}
