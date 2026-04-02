import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { invoicesApi } from '../services/api';

interface UploadResult {
  success: boolean;
  invoiceId?: number;
  numerFaktury?: string;
  itemsNeedingPurchasePrice?: number;
  error?: string;
}

export function UploadPage() {
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setError(null);
    setUploading(true);
    const newResults: UploadResult[] = [];

    try {
      for (const file of Array.from(files)) {
        try {
          const response = await invoicesApi.upload(file);
          newResults.push({
            success: true,
            invoiceId: response.data.invoiceId,
            numerFaktury: response.data.numerFaktury,
            itemsNeedingPurchasePrice: response.data.itemsNeedingPurchasePrice,
          });
          toast.success(`Invoice ${response.data.numerFaktury} uploaded successfully`);
        } catch (err: any) {
          console.error('Upload error:', err);
          let errorMessage = 'Processing error';
          if (err?.response?.data?.error) {
            errorMessage = err.response.data.error;
            if (err?.response?.data?.details) {
              errorMessage = `${errorMessage}: ${err.response.data.details}`;
            }
          } else if (err?.message) {
            errorMessage = err.message;
          }
          newResults.push({
            success: false,
            error: errorMessage,
          });
          toast.error(`Upload failed: ${errorMessage}`);
        }
      }

      setResults((prev) => [...prev, ...newResults]);
      
      // Show summary toast
      const successCount = newResults.filter(r => r.success).length;
      const failCount = newResults.filter(r => !r.success).length;
      if (successCount > 0 && failCount === 0) {
        toast.success(`All ${successCount} invoice(s) uploaded successfully`);
      } else if (successCount > 0 && failCount > 0) {
        toast.success(`${successCount} uploaded, ${failCount} failed`);
      }
    } catch (err: any) {
      console.error('Critical error:', err);
      const criticalError = 'Critical error: ' + (err?.message || 'Unknown error');
      setError(criticalError);
      toast.error(criticalError);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const clearResults = () => {
    setResults([]);
    setError(null);
    toast.success('Results cleared');
  };

  const successfulUploads = results.filter((r) => r.success);
  const failedUploads = results.filter((r) => !r.success);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Upload Invoices</h2>

      {/* Error Display */}
      {error && (
        <div className="card mb-6 bg-red-50 border-red-200">
          <div className="flex items-center gap-3 text-danger">
            <AlertCircle size={24} />
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* File Upload */}
      <div className="card mb-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <input
            type="file"
            ref={fileInputRef}
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            disabled={uploading}
            className="hidden"
            id="pdf-upload"
          />
          <label 
            htmlFor="pdf-upload"
            className={`cursor-pointer block ${uploading ? 'opacity-50' : ''}`}
          >
            <Upload className="mx-auto mb-4 text-gray-400" size={48} />
            <p className="text-lg text-text mb-2">
              Click to select PDF files
            </p>
            <p className="text-text-muted">
              or drag and drop here
            </p>
          </label>
          {uploading && (
            <p className="mt-4 text-primary font-medium">Processing...</p>
          )}
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-8">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Results</h3>
            <button
              onClick={clearResults}
              className="text-sm text-text-muted hover:text-text flex items-center gap-1"
            >
              <X size={16} />
              Clear
            </button>
          </div>

          {/* Successful uploads */}
          {successfulUploads.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-success mb-3 flex items-center gap-2">
                <CheckCircle size={16} />
                Successfully Processed ({successfulUploads.length})
              </h4>
              <div className="space-y-2">
                {successfulUploads.map((result, index) => (
                  <div
                    key={index}
                    className="card py-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="text-primary" size={24} />
                      <div>
                        <p className="font-medium">{result.numerFaktury}</p>
                        {result.itemsNeedingPurchasePrice && result.itemsNeedingPurchasePrice > 0 ? (
                          <p className="text-sm text-warning">
                            {result.itemsNeedingPurchasePrice} product(s) need purchase price
                          </p>
                        ) : (
                          <p className="text-sm text-success">All purchase prices filled</p>
                        )}
                      </div>
                    </div>
                    <a
                      href={`/invoices/${result.invoiceId}`}
                      className="btn-primary text-sm"
                    >
                      View
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed uploads */}
          {failedUploads.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-danger mb-3 flex items-center gap-2">
                <AlertCircle size={16} />
                Errors ({failedUploads.length})
              </h4>
              <div className="space-y-2">
                {failedUploads.map((result, index) => (
                  <div
                    key={index}
                    className="card py-4 bg-red-50 border-red-200"
                  >
                    <div className="flex items-center gap-3">
                      <AlertCircle className="text-danger" size={24} />
                      <p className="text-danger">{result.error}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="card mt-8">
        <h3 className="text-lg font-semibold mb-4">Instructions</h3>
        <ol className="list-decimal list-inside space-y-2 text-text-muted">
          <li>Select PDF files with invoices</li>
          <li>System will automatically extract data from invoices</li>
          <li>Products will be recognized or created</li>
          <li>Fill in missing purchase prices in invoice details</li>
          <li>Profits will be automatically calculated</li>
        </ol>
      </div>
    </div>
  );
}
