package com.adie.codexonphone;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class CodexSnapshot {
    public enum UsageStatus {
        AVAILABLE,
        UNAVAILABLE,
        STALE
    }

    public enum TaskStatus {
        RUNNING,
        WAITING,
        REVIEW,
        FAILED
    }

    public static final class Task {
        private final String id;
        private final String title;
        private final String workspaceName;
        private final TaskStatus status;
        private final long updatedAt;

        public Task(
                String id,
                String title,
                String workspaceName,
                TaskStatus status,
                long updatedAt
        ) {
            this.id = Objects.requireNonNull(id);
            this.title = Objects.requireNonNull(title);
            this.workspaceName = workspaceName;
            this.status = Objects.requireNonNull(status);
            this.updatedAt = updatedAt;
        }

        public String id() {
            return id;
        }

        public String title() {
            return title;
        }

        public String workspaceName() {
            return workspaceName;
        }

        public TaskStatus status() {
            return status;
        }

        public long updatedAt() {
            return updatedAt;
        }
    }

    private final int version;
    private final long sequence;
    private final long capturedAt;
    private final UsageStatus usageStatus;
    private final Integer remainingPercent;
    private final Long resetsAt;
    private final List<Task> tasks;
    private final boolean tasksHidden;

    public CodexSnapshot(
            int version,
            long sequence,
            long capturedAt,
            UsageStatus usageStatus,
            Integer remainingPercent,
            Long resetsAt,
            List<Task> tasks,
            boolean tasksHidden
    ) {
        this.version = version;
        this.sequence = sequence;
        this.capturedAt = capturedAt;
        this.usageStatus = Objects.requireNonNull(usageStatus);
        this.remainingPercent = remainingPercent;
        this.resetsAt = resetsAt;
        this.tasks = Collections.unmodifiableList(new ArrayList<>(tasks));
        this.tasksHidden = tasksHidden;
    }

    public static CodexSnapshot waitingForDesktop(boolean tasksHidden) {
        return new CodexSnapshot(
                1,
                0,
                System.currentTimeMillis(),
                UsageStatus.UNAVAILABLE,
                null,
                null,
                Collections.emptyList(),
                tasksHidden
        );
    }

    public CodexSnapshot withTasksHidden(boolean hidden) {
        return new CodexSnapshot(
                version,
                sequence,
                capturedAt,
                usageStatus,
                remainingPercent,
                resetsAt,
                tasks,
                hidden
        );
    }

    public int version() {
        return version;
    }

    public long sequence() {
        return sequence;
    }

    public long capturedAt() {
        return capturedAt;
    }

    public UsageStatus usageStatus() {
        return usageStatus;
    }

    public Integer remainingPercent() {
        return remainingPercent;
    }

    public Long resetsAt() {
        return resetsAt;
    }

    public List<Task> tasks() {
        return tasks;
    }

    public int runningCount() {
        int count = 0;
        for (Task task : tasks) {
            if (task.status() == TaskStatus.RUNNING
                    || task.status() == TaskStatus.WAITING) {
                count++;
            }
        }
        return count;
    }

    public int completedCount() {
        return count(TaskStatus.REVIEW);
    }

    public boolean tasksHidden() {
        return tasksHidden;
    }

    public boolean hasAttentionTransitionComparedWith(CodexSnapshot previous) {
        if (previous == null || previous.sequence() == 0) {
            return false;
        }
        for (Task task : tasks) {
            if (!isAttentionStatus(task.status())) {
                continue;
            }
            TaskStatus previousStatus = previous.statusFor(task.id());
            if (previousStatus != task.status()) {
                return true;
            }
        }
        return false;
    }

    private TaskStatus statusFor(String id) {
        for (Task task : tasks) {
            if (task.id().equals(id)) {
                return task.status();
            }
        }
        return null;
    }

    private static boolean isAttentionStatus(TaskStatus status) {
        return status == TaskStatus.WAITING
                || status == TaskStatus.REVIEW
                || status == TaskStatus.FAILED;
    }

    private int count(TaskStatus expected) {
        int count = 0;
        for (Task task : tasks) {
            if (task.status() == expected) {
                count++;
            }
        }
        return count;
    }

}
