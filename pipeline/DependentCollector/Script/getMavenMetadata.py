import os
import pandas as pd

# Folder containing original CSV files
input_folder = "./Data"

# Folder to save processed CSVs
output_folder = os.path.join(input_folder, "processed_csvs")
os.makedirs(output_folder, exist_ok=True)  # Create the folder if it doesn't exist

# Process each CSV file in the folder
for file in os.listdir(input_folder):
    if file.endswith(".csv"):
        file_path = os.path.join(input_folder, file)
        
        # Load CSV
        df = pd.read_csv(file_path)

        # Ensure 'release_id' column exists
        if "release_id" in df.columns:
            # Split the 'release_id' column and create new columns
            split_values = df["release_id"].str.split(":", expand=True)
            df["depGroupId"] = split_values[0]
            df["depArtifactId"] = split_values[1]
            df["Depversion"] = split_values[2]

            # Save the processed CSV in the output folder
            output_file_path = os.path.join(output_folder, file)
            df.to_csv(output_file_path, index=False)

            print(f"Processed and saved: {output_file_path}")

print("Processing complete!")
