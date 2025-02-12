const { processExcelData } = require('../services/lhdn/processExcelData');
const fs = require('fs');
const path = require('path');

describe('LHDN Processor', () => {
  const testDataPath = path.join(__dirname, 'testData');

  beforeAll(() => {
    // Create test data directory if it doesn't exist
    if (!fs.existsSync(testDataPath)) {
      fs.mkdirSync(testDataPath);
    }
  });

  test('should process valid Excel file correctly', async () => {
    const testFile = path.join(testDataPath, 'valid_invoice.xls');
    // Add test file creation logic here

    const result = await processExcelData(testFile);
    expect(result).toBeDefined();
    // Add more assertions based on expected output
  });

  test('should handle invalid Excel file format', async () => {
    const testFile = path.join(testDataPath, 'invalid_format.xls');
    // Add test file creation logic here

    await expect(processExcelData(testFile))
      .rejects
      .toThrow('Invalid file format');
  });
});
