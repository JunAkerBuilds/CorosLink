package org.coroslink.watchfacecompiler;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import com.yf.coros.watchface.WatchfaceParser;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** An offline compiler only: this APK declares no network or Bluetooth permissions. */
public final class CompilerActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this);
        text.setText("Compiling watch face locally…");
        setContentView(text);
        String job = getIntent().getStringExtra("job");
        if (job == null || !job.matches("[a-f0-9-]{36}")) { finish(); return; }
        new Thread(() -> compile(job, text), "coroslink-compiler").start();
    }

    private void compile(String id, TextView text) {
        File job = new File(getFilesDir(), "jobs/" + id);
        int faceId = getIntent().getIntExtra("face_id", 416);
        JSONObject result = new JSONObject();
        try {
            File input = new File(job, "input.dat"), output = new File(job, "out");
            if (!input.isFile() || !output.mkdirs()) throw new Exception("Compiler input or output is unavailable.");
            boolean parsed, exported;
            try (WatchfaceParser parser = new WatchfaceParser()) {
                parsed = parser.nativeParseTemplate(input.getAbsolutePath(), output.getAbsolutePath());
                exported = parsed && parser.nativeExportBin("watchface_416x416", new File(output, "watchface_416x416.bin").getAbsolutePath(), faceId, 0, -1, 1);
            }
            result.put("parsed", parsed); result.put("exported", exported);
            ArrayList<File> bins = new ArrayList<>();
            findBins(output, bins);
            File bin = bins.stream().filter(f -> f.getName().equals("watchface_416x416.bin")).findFirst().orElse(bins.size() == 1 ? bins.get(0) : null);
            if (!parsed || !exported || bin == null) throw new Exception("The native compiler did not produce one 416px BIN.");
            result.put("ok", true);
            result.put("bin", "out/" + output.toPath().relativize(bin.toPath()).toString());
            result.put("bytes", bin.length());
        } catch (Throwable error) {
            try { result.put("ok", false); result.put("error", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage())); }
            catch (Exception ignored) {}
        }
        try {
            File temporary = new File(job, "result.tmp"), destination = new File(job, "result.json");
            try (FileOutputStream stream = new FileOutputStream(temporary)) { stream.write(result.toString().getBytes(StandardCharsets.UTF_8)); }
            if (!temporary.renameTo(destination)) throw new Exception("Could not save compiler result.");
        } catch (Exception ignored) {}
        String message = result.optBoolean("ok") ? "BIN compiled locally." : result.optString("error", "Compilation failed.");
        runOnUiThread(() -> { text.setText(message); finish(); });
    }

    private void findBins(File folder, ArrayList<File> bins) {
        File[] files = folder.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) findBins(file, bins);
            else if (file.getName().endsWith(".bin")) bins.add(file);
        }
    }
}
