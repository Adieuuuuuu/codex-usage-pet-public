package com.adie.codexonphone;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.nio.file.Files;
import java.nio.file.Path;

import javax.xml.parsers.DocumentBuilderFactory;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public final class NotificationLayoutContractTest {
    private static final String ANDROID_NAMESPACE =
            "http://schemas.android.com/apk/res/android";

    @Test
    public void expandedUsageFieldsKeepDistinctBindings() throws Exception {
        Document layout = parse(
                "src/main/res/layout/notification_usage_pet.xml"
        );

        assertText(layout, "reset_month", "");
        assertText(layout, "reset_day", "");
        assertDateIdIsNotOnPercentMark(layout, "reset_month", "reset_day");
    }

    @Test
    public void compactUsageFieldsKeepDistinctBindings() throws Exception {
        Document layout = parse(
                "src/main/res/layout/notification_usage_compact.xml"
        );

        assertText(
                layout,
                "compact_reset_month",
                ""
        );
        assertText(
                layout,
                "compact_reset_day",
                ""
        );
        assertDateIdIsNotOnPercentMark(
                layout,
                "compact_reset_month",
                "compact_reset_day"
        );
    }

    @Test
    public void runningTaskSlotsUseSystemHostedIndeterminateProgress()
            throws Exception {
        Document layout = parse(
                "src/main/res/layout/notification_usage_pet.xml"
        );

        for (int index = 1; index <= 3; index++) {
            Element spinner = findById(layout, "task_spinner_" + index);
            assertEquals("ProgressBar", spinner.getTagName());
            assertEquals(
                    "@drawable/ic_task_running_indeterminate",
                    androidAttribute(spinner, "indeterminateDrawable")
            );
            assertEquals("true", androidAttribute(spinner, "indeterminate"));
            assertEquals("true", androidAttribute(spinner, "indeterminateOnly"));
            assertEquals("repeat",
                    androidAttribute(spinner, "indeterminateBehavior"));
            assertEquals("850",
                    androidAttribute(spinner, "indeterminateDuration"));
            assertEquals("gone", androidAttribute(spinner, "visibility"));
        }

        Element rotatingRing = parse(
                "src/main/res/drawable/ic_task_running_indeterminate.xml"
        ).getDocumentElement();
        assertEquals("rotate", rotatingRing.getTagName());
        assertEquals(
                "@drawable/ic_task_running",
                androidAttribute(rotatingRing, "drawable")
        );
        assertEquals("0", androidAttribute(rotatingRing, "fromDegrees"));
        assertEquals("360", androidAttribute(rotatingRing, "toDegrees"));
    }

    @Test
    public void runningSpinnerMatchesUsagePetTrackAndBlueArc()
            throws Exception {
        Document ring = parse(
                "src/main/res/drawable/ic_task_running.xml"
        );
        NodeList paths = ring.getElementsByTagName("path");
        assertEquals(2, paths.getLength());

        Element track = (Element) paths.item(0);
        assertEquals(
                "@android:color/transparent",
                androidAttribute(track, "fillColor")
        );
        assertEquals(
                "M11,4 A7,7 0,1 1,11,18 A7,7 0,1 1,11,4",
                androidAttribute(track, "pathData")
        );
        assertEquals("@color/usage_blue",
                androidAttribute(track, "strokeColor"));
        assertEquals("0.34", androidAttribute(track, "strokeAlpha"));

        Element arc = (Element) paths.item(1);
        assertEquals(
                "M11,4 A7,7 0,0 1,18,11",
                androidAttribute(arc, "pathData")
        );
        assertEquals("@color/usage_blue",
                androidAttribute(arc, "strokeColor"));
        assertEquals("", androidAttribute(arc, "strokeAlpha"));
    }

    private static void assertText(
            Document document,
            String id,
            String expectedText
    ) {
        assertEquals(
                expectedText,
                androidAttribute(findById(document, id), "text")
        );
    }

    private static void assertDateIdIsNotOnPercentMark(
            Document document,
            String monthId,
            String dayId
    ) {
        Element percentMark = findByText(
                document,
                "@string/usage_percent_mark"
        );
        String percentId = androidAttribute(percentMark, "id");
        assertTrue(!percentId.endsWith("/" + monthId));
        assertTrue(!percentId.endsWith("/" + dayId));
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
        throw new AssertionError("Missing Android view ID: " + id);
    }

    private static Element findByText(Document document, String text) {
        NodeList elements = document.getElementsByTagName("*");
        for (int index = 0; index < elements.getLength(); index++) {
            Node node = elements.item(index);
            if (!(node instanceof Element)) {
                continue;
            }
            Element element = (Element) node;
            if (text.equals(androidAttribute(element, "text"))) {
                return element;
            }
        }
        throw new AssertionError("Missing Android text binding: " + text);
    }

    private static String androidAttribute(Element element, String name) {
        assertNotNull(element);
        return element.getAttributeNS(ANDROID_NAMESPACE, name);
    }

    private static Document parse(String relativePath) throws Exception {
        Path workingDirectory = Path.of(System.getProperty("user.dir"));
        Path direct = workingDirectory.resolve(relativePath);
        Path insideApp = workingDirectory.resolve("app").resolve(relativePath);
        Path source = Files.exists(direct) ? direct : insideApp;
        assertTrue("Missing source resource: " + source, Files.exists(source));

        DocumentBuilderFactory factory =
                DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        return factory.newDocumentBuilder().parse(source.toFile());
    }
}
