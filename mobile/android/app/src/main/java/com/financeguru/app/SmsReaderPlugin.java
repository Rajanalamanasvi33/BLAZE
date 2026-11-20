package com.financeguru.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.regex.Pattern;

/**
 * Reads bank / UPI transaction SMS from the phone.
 * Privacy: only messages that look like a bank transaction (account or UPI words + credited/debited + an amount)
 * ever leave this class. Personal chats and OTPs are filtered out on the phone itself.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS })
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final Pattern BANKISH = Pattern.compile("(a/c|acct|account|upi|vpa|neft|imps|card)", Pattern.CASE_INSENSITIVE);
    private static final Pattern MOVE = Pattern.compile("(credited|debited|received|deposited|spent|paid|withdrawn|sent)", Pattern.CASE_INSENSITIVE);
    private static final Pattern AMOUNT = Pattern.compile("(rs\\.?|inr|₹)\\s*[\\d,]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern OTP = Pattern.compile("(\\botp\\b|one[- ]time password|verification code)", Pattern.CASE_INSENSITIVE);

    private BroadcastReceiver receiver;

    static boolean isTransaction(String body) {
        if (body == null) return false;
        return BANKISH.matcher(body).find() && MOVE.matcher(body).find() && AMOUNT.matcher(body).find() && !OTP.matcher(body).find();
    }

    @Override
    public void load() {
        // Live listener: forwards new bank SMS to the web app while it is open
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
                if (parts == null || parts.length == 0) return;
                StringBuilder body = new StringBuilder();
                for (SmsMessage p : parts) body.append(p.getMessageBody());
                String text = body.toString();
                if (!isTransaction(text)) return;
                JSObject sms = new JSObject();
                sms.put("sender", parts[0].getOriginatingAddress());
                sms.put("text", text);
                sms.put("date", parts[0].getTimestampMillis());
                notifyListeners("smsReceived", sms, true);
            }
        };
        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else getContext().registerReceiver(receiver, filter);
    }

    @Override
    protected void handleOnDestroy() {
        try { if (receiver != null) getContext().unregisterReceiver(receiver); } catch (Exception ignored) {}
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) { status(call); return; }
        requestPermissionForAlias("sms", call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) { status(call); }

    /** readInbox({ since: epochMillis, limit: 200 }) → { messages: [{sender, text, date}], scanned } */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("SMS permission not granted", "NO_PERMISSION"); return; }
        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 200);
        JSArray out = new JSArray();
        int scanned = 0;
        Uri inbox = Uri.parse("content://sms/inbox");
        try (Cursor c = getContext().getContentResolver().query(inbox, new String[] { "address", "body", "date" },
                "date >= ?", new String[] { String.valueOf(since) }, "date DESC")) {
            while (c != null && c.moveToNext() && out.length() < limit) {
                scanned++;
                String body = c.getString(1);
                if (!isTransaction(body)) continue;
                JSObject m = new JSObject();
                m.put("sender", c.getString(0));
                m.put("text", body);
                m.put("date", c.getLong(2));
                out.put(m);
            }
        } catch (Exception e) { call.reject("Could not read SMS: " + e.getMessage()); return; }
        JSObject r = new JSObject();
        r.put("messages", out);
        r.put("scanned", scanned);
        call.resolve(r);
    }
}
