package com.adie.codexonphone;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import javax.xml.parsers.DocumentBuilderFactory;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public final class AndroidSurfaceContractTest {
    private static final String ANDROID_NAMESPACE =
            "http://schemas.android.com/apk/res/android";

    @Test
    public void productionActivityHasNoPrototypeOrFakeStateEntryPoints()
            throws Exception {
        String activity = readSource(
                "src/main/java/com/adie/codexonphone/MainActivity.java"
        );

        assertFalse(activity.contains("FakeCodexState"));
        assertFalse(activity.contains("BuildConfig.DEBUG"));
        assertFalse(activity.contains("post_notification"));
        assertFalse(activity.contains("simulate_complete"));
        assertFalse(activity.contains("simulate_viewed"));
        assertFalse(activity.contains("restore_state"));
        assertFalse(activity.contains("clear_notification"));
    }

    @Test
    public void mainLayoutContainsOnlyPairingControls() throws Exception {
        Document layout = parse("src/main/res/layout/activity_main.xml");

        assertNotNull(findById(layout, "root_scroll"));
        assertNotNull(findById(layout, "connect"));
        assertNotNull(findById(layout, "disconnect"));
        assertFalse(hasId(layout, "debug_controls"));
        assertFalse(hasId(layout, "post_notification"));
        assertFalse(hasId(layout, "simulate_complete"));
        assertFalse(hasId(layout, "simulate_viewed"));
        assertFalse(hasId(layout, "toggle_tasks"));
        assertFalse(hasId(layout, "restore_state"));
        assertFalse(hasId(layout, "clear_notification"));
    }

    @Test
    public void activityAppliesSystemBarAndDisplayCutoutInsets()
            throws Exception {
        String activity = readSource(
                "src/main/java/com/adie/codexonphone/MainActivity.java"
        );
        Document layout = parse("src/main/res/layout/activity_main.xml");

        assertTrue(activity.contains("setOnApplyWindowInsetsListener"));
        assertTrue(activity.contains("WindowInsets.Type.systemBars()"));
        assertTrue(activity.contains("WindowInsets.Type.displayCutout()"));
        assertTrue(activity.contains("getSystemWindowInsetTop()"));
        assertTrue(activity.contains("getDisplayCutout()"));
        assertTrue(activity.contains("getSafeInsetTop()"));
        assertTrue(activity.contains("setPadding("));
        assertTrue(
                "false".equals(androidAttribute(
                        findById(layout, "root_scroll"),
                        "clipToPadding"
                ))
        );
    }

    @Test
    public void packagedSourcesContainNoFakeStateImplementation()
            throws Exception {
        Path fakeState = sourcePath(
                "src/main/java/com/adie/codexonphone/FakeCodexState.java"
        );
        assertFalse(Files.exists(fakeState));

        String packagedSurface = String.join(
                "\n",
                readSource(
                        "src/main/java/com/adie/codexonphone/NotificationPublisher.java"
                ),
                readSource(
                        "src/main/java/com/adie/codexonphone/NotificationActionReceiver.java"
                ),
                readSource(
                        "src/main/java/com/adie/codexonphone/CodexSnapshot.java"
                ),
                readSource("src/main/res/values/strings.xml"),
                readSource("src/main/res/layout/notification_usage_pet.xml"),
                readSource("src/main/res/layout/notification_usage_compact.xml")
        );

        assertFalse(packagedSurface.contains("FakeCodexState"));
        assertFalse(packagedSurface.contains("phase0_fake_codex_state"));
        assertFalse(packagedSurface.contains("fakeTasks("));
        assertFalse(packagedSurface.contains("fake_task_"));
        assertFalse(packagedSurface.contains("本地假数据"));
        assertFalse(packagedSurface.contains("显示原型通知"));
        assertFalse(packagedSurface.contains("模拟任务"));
    }

    private static boolean hasId(Document document, String id) {
        return findById(document, id) != null;
    }

    private static Element findById(Document document, String id) {
        NodeList elements = document.getElementsByTagName("*");
        for (int index = 0; index < elements.getLength(); index++) {
            Node node = elements.item(index);
            if (!(node instanceof Element)) {
                continue;
            }
            Element element = (Element) node;
            if (androidAttribute(element, "id").endsWith("/" + id)) {
                return element;
            }
        }
        return null;
    }

    private static String androidAttribute(Element element, String name) {
        assertNotNull(element);
        return element.getAttributeNS(ANDROID_NAMESPACE, name);
    }

    private static String readSource(String relativePath) throws Exception {
        return new String(
                Files.readAllBytes(sourcePath(relativePath)),
                StandardCharsets.UTF_8
        );
    }

    private static Document parse(String relativePath) throws Exception {
        Path source = sourcePath(relativePath);
        assertTrue("Missing source resource: " + source, Files.exists(source));
        DocumentBuilderFactory factory =
                DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(source.toFile());
    }

    private static Path sourcePath(String relativePath) {
        Path workingDirectory = Path.of(System.getProperty("user.dir"));
        if (Files.isDirectory(workingDirectory.resolve("src/main"))) {
            return workingDirectory.resolve(relativePath);
        }
        return workingDirectory.resolve("app").resolve(relativePath);
    }
}
