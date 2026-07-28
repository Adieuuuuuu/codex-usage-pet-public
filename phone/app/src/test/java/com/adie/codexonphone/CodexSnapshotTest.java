package com.adie.codexonphone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;

public final class CodexSnapshotTest {
    @Test
    public void countsRunningWaitingAndReviewTasks() {
        CodexSnapshot snapshot = snapshot(
                false,
                task("running", CodexSnapshot.TaskStatus.RUNNING),
                task("waiting", CodexSnapshot.TaskStatus.WAITING),
                task("review", CodexSnapshot.TaskStatus.REVIEW)
        );

        assertEquals(3, snapshot.tasks().size());
        assertEquals(2, snapshot.runningCount());
        assertEquals(1, snapshot.completedCount());
        assertFalse(snapshot.tasksHidden());
    }

    @Test
    public void reviewTransitionDoesNotRemoveTheTask() {
        CodexSnapshot previous = snapshot(
                false,
                task("stable-id", CodexSnapshot.TaskStatus.RUNNING)
        );
        CodexSnapshot current = snapshot(
                false,
                task("stable-id", CodexSnapshot.TaskStatus.REVIEW)
        );

        assertEquals(1, current.tasks().size());
        assertEquals("stable-id", current.tasks().get(0).id());
        assertEquals(0, current.runningCount());
        assertEquals(1, current.completedCount());
        assertTrue(current.hasAttentionTransitionComparedWith(previous));
    }

    @Test
    public void desktopViewedSnapshotOmitsOnlyMatchingReviewTask() {
        CodexSnapshot previous = snapshot(
                false,
                task("active", CodexSnapshot.TaskStatus.RUNNING),
                task("viewed-review", CodexSnapshot.TaskStatus.REVIEW)
        );
        CodexSnapshot current = snapshot(
                false,
                task("active", CodexSnapshot.TaskStatus.RUNNING)
        );

        assertEquals(2, previous.tasks().size());
        assertEquals(1, current.tasks().size());
        assertEquals("active", current.tasks().get(0).id());
        assertEquals(1, current.runningCount());
        assertEquals(0, current.completedCount());
    }

    @Test
    public void hiddenFlagDoesNotChangeTaskState() {
        CodexSnapshot snapshot = snapshot(
                true,
                task("active", CodexSnapshot.TaskStatus.RUNNING),
                task("review", CodexSnapshot.TaskStatus.REVIEW)
        );

        assertTrue(snapshot.tasksHidden());
        assertEquals(2, snapshot.tasks().size());
        assertEquals(1, snapshot.runningCount());
        assertEquals(1, snapshot.completedCount());
    }

    private static CodexSnapshot snapshot(
            boolean hidden,
            CodexSnapshot.Task... tasks
    ) {
        return new CodexSnapshot(
                1,
                1,
                1_775_344_400_000L,
                CodexSnapshot.UsageStatus.AVAILABLE,
                22,
                1_775_344_400L,
                Arrays.asList(tasks),
                hidden
        );
    }

    private static CodexSnapshot.Task task(
            String id,
            CodexSnapshot.TaskStatus status
    ) {
        return new CodexSnapshot.Task(
                id,
                "Task " + id,
                "Workspace",
                status,
                1_775_344_400_000L
        );
    }
}
