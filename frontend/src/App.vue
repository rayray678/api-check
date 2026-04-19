<script setup>
import { onMounted, onBeforeUnmount, watch, ref, computed } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useCheckerStore } from '@/stores/checker';

// 导入组件
import ProviderSelector from './components/ProviderSelector.vue';
import ApiConfig from './components/ApiConfig.vue';
import KeyInput from './components/KeyInput.vue';
import ActionButtons from './components/ActionButtons.vue';
import ResultsTabs from './components/ResultsTabs.vue';
import ResultPanel from './components/ResultPanel.vue';
import ToastContainer from './components/ToastContainer.vue';
import ModalContainer from './components/ModalContainer.vue';

/**
 * @description 结果标签页的配置数组。
 */
const resultTabsConfig = [
    { id: 'valid', name: '有效', sortable: true },
    { id: 'lowBalance', name: '低额', sortable: true },
    { id: 'zeroBalance', name: '零额', sortable: false },
    { id: 'noQuota', name: '无额', sortable: false },
    { id: 'rateLimit', name: '限流', sortable: false },
    { id: 'invalid', name: '无效', sortable: false },
    { id: 'duplicate', name: '重复', sortable: false },
];

const uiStore = useUiStore();
const checkerStore = useCheckerStore();
const scrollPosition = ref(0);

/**
 * @description 动态计算当前年份，用于 Footer 版权信息。
 */
const currentYear = computed(() => new Date().getFullYear());

/**
 * @description 监听 checkerStore 的 lastStatusMessage 变化，并触发 UI Toast 提示。
 */
watch(() => checkerStore.lastStatusMessage, (newMessage) => {
    if (newMessage && newMessage.text) {
        uiStore.showToast(newMessage.text, newMessage.type, newMessage.duration);
    }
}, { deep: true });

/**
 * @description 侦听弹窗状态，以实现可靠的滚动锁定。
 * 当模态框激活时，锁定页面滚动；模态框关闭时，恢复滚动。
 */
watch(() => uiStore.isModalActive, (isActive) => {
    const body = document.body;
    if (isActive) {
        scrollPosition.value = window.scrollY;
        body.style.position = 'fixed';
        body.style.top = `-${scrollPosition.value}px`;
        body.style.width = '100%';
        body.classList.add('modal-open');
    } else {
        body.style.position = '';
        body.style.top = '';
        body.style.width = '';
        body.classList.remove('modal-open');
        window.scrollTo(0, scrollPosition.value);
    }
});

/**
 * @description 处理 ESC 键按下事件，用于关闭模态框。
 * @param {KeyboardEvent} e - 键盘事件对象。
 */
const handleEscKey = (e) => {
    if (e.key !== 'Escape' || !uiStore.activeModal) return;
    if (uiStore.activeModal === 'modelSelector' && uiStore.modelSearch) {
        uiStore.modelSearch = '';
    } else {
        uiStore.closeModal();
    }
};

/**
 * @description 组件挂载时添加键盘事件监听器并初始化会话。
 */
onMounted(() => {
    // 在应用启动时调用会话初始化，为当前标签页分配唯一 ID。
    // 这是实现多页面任务隔离的关键步骤。
    checkerStore.initSession();
    
    document.addEventListener('keydown', handleEscKey);
});

/**
 * @description 组件卸载前移除键盘事件监听器。
 */
onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleEscKey);
    // 完整恢复 body 样式，防止残留
    const body = document.body;
    body.style.position = '';
    body.style.top = '';
    body.style.width = '';
    body.classList.remove('modal-open');
});
</script>

<template>
    <div class="page-wrapper">
        <div class="header">
            <h1>API KEY 检测工具</h1>
        </div>
        <div class="main-grid">
            <div class="main-content">
                <div class="input-section">
                    <ProviderSelector />
                    <ApiConfig />
                </div>
                <div class="input-section">
                    <KeyInput />
                </div>
                <ActionButtons />
            </div>
            <div class="sidebar-content">
                <div class="results-wrapper">
                    <ResultsTabs />
                    <div class="results-panels">
                        <ResultPanel v-for="tab in resultTabsConfig" :key="tab.id" :category="tab.id" :title="tab.name"
                            :sortable="tab.sortable" />
                    </div>
                </div>
            </div>
        </div>
        <div class="footer">
            <p>© {{ currentYear }} LLM API KEY 检测工具 | <a href="https://github.com/ssfun/llm-api-key-checker" target="_blank"
                    rel="noopener noreferrer">@SFUN</a></p>
        </div>
        <ToastContainer />
        <ModalContainer />
    </div>
</template>

<style>
    /* 防止 Vue 渲染时闪烁未编译内容 */
    [v-cloak] {
        display: none;
    }

    /* 结果面板的通用样式 - 使用绝对定位填满容器 */
    .results-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-paper);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .results-panels {
        padding: 8px;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
    }

    /* 移动端响应式：取消绝对定位，恢复正常文档流 */
    @media (max-width: 1024px) {
        .results-wrapper {
            position: static;
            height: 500px;
        }
    }

    @media (max-width: 768px) {
        .results-wrapper {
            height: 450px;
        }
    }

    @media (max-width: 480px) {
        .results-wrapper {
            height: 400px;
        }
    }
</style>
