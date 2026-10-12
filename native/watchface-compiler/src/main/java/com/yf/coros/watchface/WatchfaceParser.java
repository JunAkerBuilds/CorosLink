package com.yf.coros.watchface;

public final class WatchfaceParser implements AutoCloseable {
    private long nativePtr;

    static {
        System.loadLibrary("c++_shared");
        System.loadLibrary("protobuf");
        System.loadLibrary("w4-watchface");
    }

    public WatchfaceParser() {
        if (!nativeCreate()) {
            throw new IllegalStateException(
                    "Failed to create native WFTemplateParser"
            );
        }
    }

    private native boolean nativeCreate();

    public native boolean nativeParseTemplate(
            String templatePath,
            String outputDirectory
    );

    public native boolean nativeExportBin(
            String inputPath,
            String outputPath,
            int value,
            int value1,
            int value2,
            int value3
    );

    private native void nativeRelease();

    @Override
    public void close() {
        if (nativePtr != 0) {
            nativeRelease();
            nativePtr = 0;
        }
    }

    public native byte[] nativeTemplate();
    public native byte[] nativeParseBinHead(String binPath);
    public native boolean nativeExportZip(
            String outputPath,
            int width,
            int height
    );

}
