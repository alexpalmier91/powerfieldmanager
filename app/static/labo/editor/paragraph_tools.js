// Paragraph Tools

import { action } from "@storybook/addon-actions";
import { html } from "lit-html";

export default {
    title: "Editor/Paragraph Tools",
};

const Template = (args) => {
    const createParagraphTool = () => {
        // Original create paragraph functionality
        return `<div class='paragraph-tool'>
            <button class='tool-button' onclick='${action("paragraph clicked")}' >${args.label}</button>
        </div>`;
    };

    return html`${createParagraphTool()}`;
};

export const Default = Template.bind({});
Default.args = {
    label: "Paragraph",
};

export const AnotherTool = Template.bind({});
AnotherTool.args = {
    label: "Another Tool",
};

// Update alignment with text_simple_tools.js behavior
const updateAlignment = (newAlignment) => {
    const tools = document.querySelectorAll('.tool-button');
    tools.forEach((tool) => {
        tool.style.textAlign = newAlignment;
    });
};

export { updateAlignment };