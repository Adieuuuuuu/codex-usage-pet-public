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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public final class AllTasksSurfaceContractTest {
    private static final String ANDROID_NAMESPACE =
            "http://schemas.android.com/apk/res/android";

    @Test
    public void activityRendersEveryVerifiedSnapshotTask() throws Exception {
        Document layout = parse("src/main/res/layout/activity_main.xml");
        String activity = source(
                "src/main/java/com/adie/codexonphone/MainActivity.java"
        );
        String stateStore = source(
                "src/main/java/com/adie/codexonphone/SyncStateStore.java"
        );

        assertNotNull(findById(layout, "activity_task_count"));
        assertNotNull(findById(layout, "activity_task_list"));
        assertNotNull(findById(layout, "activity_task_empty"));
        assertTrue(activity.contains(
                "for (CodexSnapshot.Task task : snapshot.tasks())"
        ));
        assertFalse(activity.contains("subList("));
        assertTrue(stateStore.contains(
                "private static final String SNAPSHOT_SEQUENCE"
        ));
        assertTrue(stateStore.contains(
                ".putLong(SNAPSHOT_SEQUENCE, snapshot.sequence())"
        ));
    }

    @Test
    public void notificationKeepsThreeRowsAndOpensTheCompleteList()
            throws Exception {
        Document layout = parse(
                "src/main/res/layout/notification_usage_pet.xml"
        );
        String publisher = source(
                "src/main/java/com/adie/codexonphone/NotificationPublisher.java"
        );

        assertNotNull(findById(layout, "task_row_1"));
        assertNotNull(findById(layout, "task_row_2"));
        assertNotNull(findById(layout, "task_row_3"));
        assertFalse(hasId(layout, "task_row_4"));
        assertTrue(publisher.contains("snapshot.tasks().size() > 3"));
        assertTrue(publisher.contains("R.string.notification_task_count_all"));
        assertTrue(publisher.contains("R.id.task_count"));
        assertTrue(publisher.contains("openAppIntent(context)"));
    }

    @Test
    public void mobileNameAndOriginalLauncherIconShipTogether()
            throws Exception {
        Document strings = parse("src/main/res/values/strings.xml");
        Document manifest = parse("src/main/AndroidManifest.xml");

        assertEquals(
                "Codex Usage Pet Mobile",
                stringValue(strings, "app_name")
        );
        assertEquals(
                "Codex Usage Pet Mobile",
                stringValue(strings, "screen_title")
        );
        assertEquals(
                "@mipmap/ic_launcher",
                androidAttribute(
                        manifest.getElementsByTagName("application").item(0),
                        "icon"
                )
        );
        assertTrue(Files.exists(sourcePath(
                "src/main/res/mipmap-anydpi-v26/ic_launcher.xml"
        )));
        assertTrue(Files.exists(sourcePath(
                "src/main/res/drawable/ic_launcher_foreground.xml"
        )));
    }

    private static String stringValue(Document document, String name) {
        NodeList strings = document.getElementsByTagName("string");
        for (int index = 0; index < strings.getLength(); index++) {
            Element element = (Element) strings.item(index);
            if (name.equals(element.getAttribute("name"))) {
                return element.getTextContent();
            }
        }
        throw new AssertionError("Missing string resource: " + name);
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

    private static String androidAttribute(Node node, String name) {
        assertTrue(node instanceof Element);
        return ((Element) node).getAttributeNS(ANDROID_NAMESPACE, name);
    }

    private static String source(String relativePath) throws Exception {
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
