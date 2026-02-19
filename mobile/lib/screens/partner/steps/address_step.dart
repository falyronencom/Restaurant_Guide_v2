import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Step 5: Address Step
/// Allows partner to enter establishment address: city, street, building, corpus
/// Based on Figma design "Choose adress" frame
class AddressStep extends StatefulWidget {
  const AddressStep({super.key});

  @override
  State<AddressStep> createState() => _AddressStepState();
}

class _AddressStepState extends State<AddressStep> {
  late TextEditingController _streetController;
  late TextEditingController _buildingController;
  late TextEditingController _corpusController;
  String? _selectedCity;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _greyBorder = AppTheme.strokeGrey;
  static const Color _greyText = Color(0xFF949494);

  @override
  void initState() {
    super.initState();
    final provider = context.read<PartnerRegistrationProvider>();
    _streetController = TextEditingController(text: provider.data.street ?? '');
    _buildingController = TextEditingController(text: provider.data.building ?? '');
    // Parse corpus from building if present (format: "дом, корпус")
    final building = provider.data.building ?? '';
    if (building.contains(',')) {
      final parts = building.split(',');
      _buildingController.text = parts[0].trim();
      _corpusController = TextEditingController(text: parts.length > 1 ? parts[1].trim() : '');
    } else {
      _corpusController = TextEditingController();
    }
    _selectedCity = provider.data.city;
  }

  @override
  void dispose() {
    _streetController.dispose();
    _buildingController.dispose();
    _corpusController.dispose();
    super.dispose();
  }

  void _updateProvider() {
    final provider = context.read<PartnerRegistrationProvider>();
    // Combine building and corpus
    String building = _buildingController.text.trim();
    if (_corpusController.text.trim().isNotEmpty) {
      building = '$building, ${_corpusController.text.trim()}';
    }
    provider.updateAddress(
      city: _selectedCity,
      street: _streetController.text.trim(),
      building: building,
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 8),

          // Section header
          _buildSectionHeader(),

          const SizedBox(height: 24),

          // Address fields container
          _buildAddressFields(),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  /// Build section header with title and subtitle
  Widget _buildSectionHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Title
        Text(
          'Заполните адрес',
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 22,
            fontWeight: FontWeight.w400,
            color: Colors.black,
          ),
        ),
        const SizedBox(height: 8),
        // Subtitle
        const Text(
          'Выберите или введите данные местонахождения вашего заведения',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: _greyText,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 16),
        // Divider
        Container(
          height: 1,
          color: _greyBorder,
        ),
      ],
    );
  }

  /// Build address fields container
  Widget _buildAddressFields() {
    return Column(
      children: [
        // City and Street in one container
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: _greyBorder),
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          ),
          child: Column(
            children: [
              // City dropdown
              _buildCityDropdown(),
              // Divider
              Container(height: 1, color: _greyBorder),
              // Street field
              _buildTextField(
                controller: _streetController,
                label: 'Улица',
                onChanged: (_) => _updateProvider(),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Building and Corpus in one row
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: _greyBorder),
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          ),
          child: IntrinsicHeight(
            child: Row(
              children: [
                // Building field
                Expanded(
                  child: _buildTextField(
                    controller: _buildingController,
                    label: 'Дом',
                    onChanged: (_) => _updateProvider(),
                  ),
                ),
                // Vertical divider
                Container(width: 1, color: _greyBorder),
                // Corpus field
                Expanded(
                  child: _buildTextField(
                    controller: _corpusController,
                    label: 'Корпус',
                    onChanged: (_) => _updateProvider(),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Build city dropdown
  Widget _buildCityDropdown() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedCity,
          isExpanded: true,
          hint: const Text(
            'Населенный пункт',
            style: TextStyle(
              fontSize: 16,
              color: _greyText,
            ),
          ),
          style: const TextStyle(
            fontSize: 16,
            color: Colors.black,
          ),
          icon: const Icon(Icons.keyboard_arrow_down, color: _greyText),
          dropdownColor: _backgroundColor,
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          items: CityOptions.cities.map((city) {
            return DropdownMenuItem<String>(
              value: city,
              child: Text(city),
            );
          }).toList(),
          onChanged: (value) {
            setState(() {
              _selectedCity = value;
            });
            if (value != null) {
              final coords = CityOptions.coordinatesFor(value);
              final provider = context.read<PartnerRegistrationProvider>();
              provider.updateAddress(
                city: value,
                street: _streetController.text.trim(),
                building: _buildingController.text.trim(),
                latitude: coords.$1,
                longitude: coords.$2,
              );
            } else {
              _updateProvider();
            }
          },
        ),
      ),
    );
  }

  /// Build text field
  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required ValueChanged<String> onChanged,
  }) {
    return TextField(
      controller: controller,
      style: const TextStyle(
        fontSize: 16,
        color: Colors.black,
      ),
      decoration: InputDecoration(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        hintText: label,
        hintStyle: const TextStyle(
          fontSize: 16,
          color: _greyText,
        ),
      ),
      onChanged: onChanged,
    );
  }
}
