<template>
    <div class="modal-content">
        <div class="modal-header">
            <div class="modal-icon info">ℹ</div>
            <h3 class="modal-title">请确认</h3>
        </div>
        <div class="modal-message">{{ uiStore.modalData.message }}</div>
        <div class="modal-actions confirmation">
            <button class="modal-btn secondary" @click="uiStore.handleConfirmation(false)">取消</button>
            <button class="modal-btn primary" @click="uiStore.handleConfirmation(true)">确定</button>
        </div>
    </div>
</template>

<script setup>
import { useUiStore } from '@/stores/ui';
const uiStore = useUiStore();
</script>

<style scoped>
    /* 确认模态框特定样式 */
    .modal-content {
        max-width: 500px;
    }

    .modal-message {
        text-align: center;
    }
</style>