// Updated paragraph_tools.js to enhance toolbar behavior

function showToolbar() {
    // Implementation for showing the toolbar
}

function hideToolbar() {
    // Implementation for hiding the toolbar
}

function attachToolbarToBlock(block) {
    // Implementation to position the toolbar based on the active block coordinates
}

function clearToolbar() {
    // Implementation to clear the toolbar on deselection or delete operations
}

function handleEditBlock(block) {
    showToolbar();
    attachToolbarToBlock(block);
}

function handleSelectBlock(block) {
    // Show the toolbar when selecting blocks
    showToolbar();
    attachToolbarToBlock(block);
}

function handleDeselectBlock() {
    hideToolbar();
    clearToolbar();
}

function handleDeleteBlock() {
    hideToolbar();
    clearToolbar();
}

// ... (Other existing functionalities)